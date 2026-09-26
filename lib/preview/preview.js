// Превью markdown для Монако 0.29: страница рядом с редактором. Обновляется
// на паузах в наборе; прокрутка связана в обе стороны.
//
// Разбор — marked из vendor/ (npm run vendor): у marked из сборки Монако
// разбор длинного списка квадратичный. Грузится, только когда превью
// впервые понадобилось. Чистка HTML — DOMPurify из сборки Монако
// (vs/base/browser/dompurify/dompurify), код в блоках ``` раскрашивают
// токенизаторы самого Монако — цвета те же, что в редакторе.
//
// Показываем в <iframe sandbox> без allow-scripts: текст приходит по ссылке
// от кого угодно, и даже то, что пропустит DOMPurify, выполниться не сможет,
// а стили из текста не вылезут на страницу. Текст документа превью
// не трогает, поэтому в комнате ему ломать нечего.
//
//   var preview = attachMarkdownPreview(editor, {
//     container: element,             // сюда ляжет <iframe>; прячется сам
//     markedUrl: '../lib/preview/vendor/marked.umd.js',
//     enabled: true,
//     onStatus: function (status) {},  // { state, message }
//   });
//   preview.setEnabled(false);
//
// state: notMarkdown | off | on | error

function attachMarkdownPreview (editor, opts) {
	var LANGUAGE = 'markdown';
	var MODULES = ['marked', 'vs/base/browser/dompurify/dompurify'];
	// пауза в наборе перед перерисовкой. На больших текстах растёт вместе
	// со временем отрисовки, чтобы набор в неё не упирался
	var MIN_DELAY = 250;
	var MAX_DELAY = 3000;
	// без allow-scripts: скриптам из текста выполняться негде. allow-same-origin
	// нужен странице, чтобы писать в превью и прокручивать его, а popups —
	// чтобы ссылки открывались в новой вкладке обычными страницами
	var SANDBOX = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox';
	// ведущий <style> без FORCE_BODY DOMPurify унёс бы в <head> и выбросил
	var PURIFY = { FORCE_BODY: true };
	// чем пользователь берётся за прокрутку. mouseenter — отдельно: полоса
	// прокрутки iframe не везде отдаёт mousedown в его документ
	var INPUT_EVENTS = ['mousedown', 'wheel', 'touchstart', 'keydown'];
	var INPUT_OPTIONS = { capture: true, passive: true };

	var model = editor.getModel();
	var container = opts.container;
	var enabled = !!opts.enabled;
	var marked = null;
	var purify = null;
	var loading = false;
	var errorMessage = '';
	var frame = null;
	var frameReady = false;
	var frameResets = 0;
	var timer = 0;
	var delay = MIN_DELAY;
	var languages = null;
	// язык + код → раскрашенный HTML; null — раскрасить не вышло. Держит
	// ровно код текущего текста: кэш с потолком на тексте с кодом больше
	// потолка выталкивал бы раскрашенное, и перерисовка с раскраской
	// ходили бы по кругу, не отпуская страницу
	var highlights = new Map();
	var colorizing = false;
	// положения блоков в превью: считаются лениво, сбрасываются при перерисовке
	var anchors = null;
	var anchorsKey = '';
	var syncQueued = false;
	// Прокрутку ведёт тот, кого трогали последним: мышью, колесом, пальцем
	// или клавишами. Второй только следует — иначе, отражая прокрутку друг
	// друга, они бы толкались. Прокрутку превью от перерисовки и догруженных
	// картинок пользователь не делал, и редактор за ней не идёт
	var previewLeads = false;
	// куда превью прокрутили мы сами — эту прокрутку назад не отражаем
	var previewScrolledTo = -1;
	// редактор прокручиваем мы сами: Монако сообщает об этом сразу, внутри setScrollTop
	var scrollingEditor = false;
	var editorNode = editor.getDomNode();
	var disposables = [];

	disposables.push(editor.onDidChangeModelContent(function () {
		if (isActive()) {
			later(delay);
		}
	}));

	disposables.push(editor.onDidScrollChange(function (event) {
		if (isActive() && event.scrollTopChanged && !scrollingEditor) {
			requestSync();
		}
	}));

	// ширина редактора поменялась — строки переносятся иначе
	disposables.push(editor.onDidLayoutChange(function () {
		if (isActive()) {
			requestSync();
		}
	}));

	// режим в комнате общий: чужая смена языка приходит сюда же
	disposables.push(model.onDidChangeLanguage(refresh));

	// в документ превью те же события слушаем, когда он загрузится
	listenInput(editorNode, leadEditor);
	editorNode.addEventListener('mouseenter', leadEditor);
	container.addEventListener('mouseenter', leadPreview);

	refresh();

	return {
		setEnabled: setEnabled,
		isEnabled: function () {
			return enabled;
		},
		dispose: dispose,
	};

	function isActive () {
		return enabled && model.getModeId() === LANGUAGE;
	}

	function setEnabled (value) {
		enabled = !!value;

		// включили заново — пробуем загрузить заново
		if (enabled && !marked) {
			errorMessage = '';
		}

		refresh();
	}

	function refresh () {
		var active = isActive();

		container.hidden = !active;

		if (active) {
			render();
		}
		else {
			clear();
		}

		report();
	}

	function dispose () {
		clear();
		disposables.forEach(function (d) {
			d.dispose();
		});

		INPUT_EVENTS.forEach(function (type) {
			editorNode.removeEventListener(type, leadEditor, INPUT_OPTIONS);
		});
		editorNode.removeEventListener('mouseenter', leadEditor);
		container.removeEventListener('mouseenter', leadPreview);

		if (frame) {
			frame.remove();
			frame = null;
			frameReady = false;
		}
	}

	// спрятанное превью ничего не держит: DOM большого текста — не пустяк
	function clear () {
		clearTimeout(timer);
		anchors = null;
		highlights = new Map();

		var doc = frameDocument();

		if (doc) {
			doc.body.textContent = '';
		}
	}

	function later (ms) {
		clearTimeout(timer);
		timer = setTimeout(render, ms);
	}

	// ——— отрисовка ———————————————————————————————————————————————————

	function render () {
		clearTimeout(timer);

		// не готовы — позовут render сами, когда будут
		if (!isActive() || !ensureRenderer() || !ensureFrame()) {
			return;
		}

		var doc = frameDocument();

		if (!doc) {
			return;
		}

		var started = Date.now();
		var used = new Map();
		var missing = new Map();
		var html;

		try {
			html = markdownToHtml(marked, model.getValue(), function (code, lang) {
				return highlightFor(code, lang, used, missing);
			});
		}
		catch (e) {
			// marked споткнулся — оставляем прежнюю картинку
			console.error(e);
			return;
		}

		// кода, которого в тексте больше нет, не помним
		highlights = used;
		doc.body.innerHTML = purify.sanitize(html, PURIFY);
		fixLinks(doc);
		copyTokenStyles(doc);
		anchors = null;

		delay = Math.min(MAX_DELAY, Math.max(MIN_DELAY, (Date.now() - started) * 3));

		requestSync();

		if (missing.size) {
			colorize(missing);
		}
	}

	function ensureRenderer () {
		if (marked) {
			return true;
		}

		if (loading || errorMessage) {
			return false;
		}

		loading = true;

		// Своим тегом, а не через paths загрузчика Монако: тот неудачную
		// загрузку запоминает навсегда, и превью оживало бы только после
		// перезагрузки страницы. UMD, увидев define, сам объявит себя
		// AMD-модулем «marked»; DOMPurify — из уже загруженной сборки
		loadScript(opts.markedUrl, function () {
			require(MODULES, onModules, function (error) {
				loading = false;
				fail(error && error.message);
			});
		}, function () {
			loading = false;
			fail(opts.markedUrl + ' не загрузился');
		});

		return false;
	}

	function onModules (markedModule, purifyModule) {
		loading = false;

		if (!markedModule || typeof markedModule.lexer !== 'function' || typeof markedModule.Parser !== 'function') {
			fail('marked загрузился не тот');
			return;
		}

		if (!purifyModule || typeof purifyModule.sanitize !== 'function') {
			fail('в этой сборке Монако нет DOMPurify');
			return;
		}

		marked = markedModule;
		purify = purifyModule;
		render();
	}

	function loadScript (url, onLoad, onError) {
		var script = document.createElement('script');

		script.onload = onLoad;
		script.onerror = function () {
			// неудачный тег убираем: следующая попытка поставит новый
			script.remove();
			onError();
		};
		script.src = url;
		document.head.appendChild(script);
	}

	function fail (message) {
		errorMessage = message || 'marked не загрузился';
		report();
	}

	function ensureFrame () {
		if (frameReady) {
			return true;
		}

		if (frame) {
			// ещё грузится
			return false;
		}

		frame = document.createElement('iframe');
		frame.setAttribute('sandbox', SANDBOX);
		frame.setAttribute('title', 'Превью markdown');
		frame.onload = onFrameLoad;
		frame.setAttribute('srcdoc', PREVIEW_PAGE);
		container.appendChild(frame);

		return false;
	}

	function onFrameLoad () {
		var doc = frame && frame.contentDocument;

		// превью куда-то ушло со своей страницы — возвращаем. Не больше
		// нескольких раз: вечно перезагружающийся iframe хуже пустого
		if (!doc || doc.URL !== 'about:srcdoc') {
			frameReady = false;

			if (++frameResets <= 3) {
				frame.setAttribute('srcdoc', PREVIEW_PAGE);
			}

			return;
		}

		frameReady = true;
		frameResets = 0;
		doc.addEventListener('click', onFrameClick);
		// картинки догружаются и сдвигают блоки — положения пересчитаем
		doc.addEventListener('load', onResourceLoad, true);
		doc.addEventListener('scroll', onPreviewScroll);
		listenInput(doc, leadPreview);
		render();
	}

	function frameDocument () {
		return frameReady && frame && frame.contentDocument && frame.contentDocument.body ? frame.contentDocument : null;
	}

	// Ссылки на заголовки — внутри превью, остальные — в новой вкладке.
	// У документа из srcdoc адрес about:srcdoc, а относительные ссылки
	// считаются от адреса пасты: «#раздел» увёл бы превью на саму пасту
	function fixLinks (doc) {
		var links = doc.querySelectorAll('a[href]');

		for (var i = 0; i < links.length; i++) {
			var href = links[i].getAttribute('href');

			if (href.charAt(0) === '#') {
				links[i].setAttribute('href', 'about:srcdoc' + href);
				links[i].removeAttribute('target');
			}
			else {
				links[i].setAttribute('target', '_blank');
				links[i].setAttribute('rel', 'noopener noreferrer');
			}
		}
	}

	// переход к заголовку своими руками: так он не зависит от того,
	// как браузер понимает about:srcdoc#…
	function onFrameClick (event) {
		var link = event.target && event.target.closest ? event.target.closest('a[href^="about:srcdoc#"]') : null;

		if (!link) {
			return;
		}

		var id = link.getAttribute('href').slice('about:srcdoc#'.length);
		var target = null;

		try {
			target = link.ownerDocument.getElementById(decodeURIComponent(id));
		}
		catch (e) {
			// кривая %-последовательность — ищем как есть
		}

		target = target || link.ownerDocument.getElementById(id);

		if (target) {
			event.preventDefault();
			target.scrollIntoView();
		}
	}

	function onResourceLoad () {
		anchors = null;
		requestSync();
	}

	// классы mtk* раскраски — те же, что в редакторе; их правила Монако
	// держит в <style class="monaco-colors"> страницы
	function copyTokenStyles (doc) {
		var source = document.querySelector('style.monaco-colors');
		var target = doc.getElementById('tokens');
		var css = source ? source.textContent : '';

		if (target && target.textContent !== css) {
			target.textContent = css;
		}
	}

	// ——— раскраска кода ——————————————————————————————————————————————

	// что уже раскрашено — сразу; остальное раскрасится и перерисуется.
	// used — раскрашенное, что есть в тексте; missing — чего нет, без повторов
	function highlightFor (code, lang, used, missing) {
		var id = languageOf(lang);

		if (!id) {
			return null;
		}

		var key = id + '\n' + code;

		if (highlights.has(key)) {
			var html = highlights.get(key);

			used.set(key, html);

			return html;
		}

		missing.set(key, { id: id, code: code });

		return null;
	}

	function languageOf (lang) {
		if (!lang) {
			return '';
		}

		languages = languages || monaco.languages.getLanguages();

		var id = findMonacoLanguage(languages, lang);

		// у plaintext нет цветов — раскрашивать нечего
		return id === 'plaintext' ? '' : id;
	}

	function colorize (missing) {
		if (colorizing) {
			return;
		}

		colorizing = true;

		Promise.all(Array.from(missing, function (entry) {
			var key = entry[0];
			var item = entry[1];

			return monaco.editor.colorize(item.code, item.id, { tabSize: 4 }).then(function (html) {
				highlights.set(key, cleanColorized(html));
			}, function () {
				highlights.set(key, null);
			});
		})).then(function () {
			colorizing = false;

			// загруженный токенизатор отвечает сразу, и перерисовка случится
			// до кадра на экране — код не мигнёт бесцветным
			if (isActive()) {
				render();
			}
		});
	}

	// ——— прокрутка: превью за редактором и редактор за превью ————————

	function listenInput (target, fn) {
		INPUT_EVENTS.forEach(function (type) {
			target.addEventListener(type, fn, INPUT_OPTIONS);
		});
	}

	function leadEditor () {
		previewLeads = false;
	}

	function leadPreview () {
		previewLeads = true;
	}

	function requestSync () {
		if (syncQueued) {
			return;
		}

		syncQueued = true;

		var next = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : function (fn) {
			return setTimeout(fn, 16);
		};

		next(function () {
			syncQueued = false;
			syncScroll();
		});
	}

	function syncScroll () {
		var doc = isActive() ? frameDocument() : null;

		if (!doc) {
			return;
		}

		var win = frame.contentWindow;
		var scrollTop = editor.getScrollTop();
		var target = 0;

		if (scrollTop > 0) {
			target = previewScrollTarget(
				measure(doc, win),
				editorTopLine(scrollTop),
				model.getLineCount(),
				doc.documentElement.scrollHeight
			);
		}

		win.scrollTo(0, Math.round(target));
		// браузер уже поправил цель по границам — запоминаем, где встало
		previewScrolledTo = win.scrollY;
	}

	// превью крутит пользователь — редактор идёт за ним. Сразу, без кадра
	// ожидания: событие приходит перед отрисовкой, и редактор успеет в тот же кадр
	function onPreviewScroll () {
		var doc = frameDocument();

		if (!doc) {
			return;
		}

		var win = frame.contentWindow;
		var top = win.scrollY;
		// о прокрутке браузер сообщает раз за кадр, и только если она была:
		// своя — это всегда последняя, и больше она не повторится
		var ours = Math.abs(top - previewScrolledTo) < 1;

		previewScrolledTo = -1;

		if (ours || !previewLeads || !isActive()) {
			return;
		}

		var scrollTop = 0;

		if (top > 0) {
			scrollTop = editorTopFor(previewSourceLine(
				measure(doc, win),
				top,
				model.getLineCount(),
				doc.documentElement.scrollHeight
			));
		}

		scrollingEditor = true;

		try {
			editor.setScrollTop(Math.round(scrollTop));
		}
		finally {
			scrollingEditor = false;
		}
	}

	// верх видимой части редактора — дробный номер строки: 12.5 — середина
	// двенадцатой. С переносом строки бывают высотой в несколько рядов
	function editorTopLine (scrollTop) {
		var ranges = editor.getVisibleRanges();

		if (!ranges.length) {
			return 1;
		}

		var line = ranges[0].startLineNumber;
		var top = editor.getTopForLineNumber(line);
		var next = line < model.getLineCount() ? editor.getTopForLineNumber(line + 1) : top;

		if (next <= top) {
			return line;
		}

		return line + Math.min(1, Math.max(0, (scrollTop - top) / (next - top)));
	}

	// обратное к editorTopLine: дробный номер строки → scrollTop редактора
	function editorTopFor (line) {
		var count = model.getLineCount();
		var whole = Math.max(1, Math.min(count, Math.floor(line)));
		var top = editor.getTopForLineNumber(whole);

		if (whole >= count) {
			return top;
		}

		return top + (editor.getTopForLineNumber(whole + 1) - top) * Math.min(1, line - whole);
	}

	// где в превью начинается каждый блок. Пересчитываем, только когда
	// превью поменяло размер: чтение положений на каждом кадре прокрутки
	// большого текста заметно
	function measure (doc, win) {
		var key = doc.documentElement.scrollHeight + 'x' + win.innerWidth;

		if (anchors && anchorsKey === key) {
			return anchors;
		}

		var nodes = doc.querySelectorAll('[' + MARKDOWN_LINE_ATTR + ']');
		var scrollY = win.scrollY;
		var list = [];

		for (var i = 0; i < nodes.length; i++) {
			// блок в свёрнутом <details> места не занимает
			if (!nodes[i].getClientRects().length) {
				continue;
			}

			var line = +nodes[i].getAttribute(MARKDOWN_LINE_ATTR);
			var top = nodes[i].getBoundingClientRect().top + scrollY;
			var last = list[list.length - 1];

			// порядок могли перемешать теги из текста: вынесенное парсером
			// из таблицы вперёд только сбило бы прокрутку
			if (last && (line <= last.line || top < last.top)) {
				continue;
			}

			list.push({ line: line, top: top });
		}

		anchors = list;
		anchorsKey = key;

		return list;
	}

	// ——— состояние для кнопки ————————————————————————————————————————

	function report () {
		if (!opts.onStatus) {
			return;
		}

		var state;

		if (model.getModeId() !== LANGUAGE) {
			state = 'notMarkdown';
		}
		else if (!enabled) {
			state = 'off';
		}
		else if (errorMessage) {
			state = 'error';
		}
		else {
			state = 'on';
		}

		opts.onStatus({ state: state, message: errorMessage });
	}
}

// у каждого блока верхнего уровня — номер его первой строки в исходнике
var MARKDOWN_LINE_ATTR = 'data-pasta-line';

// markdown → HTML. Номер строки получают блоки верхнего уровня: по ним
// превью прокручивается вслед за редактором. Сырой HTML номера
// не получает — его теги могут открываться в одном блоке и закрываться
// в другом (<details> вокруг текста), и обёртка сломала бы вложенность.
// Отдаётся наружу для тестов: test/preview.test.js
function markdownToHtml (marked, text, highlight) {
	// настройки свои на каждый вызов: общие marked.defaults не трогаем
	var options = marked.getDefaults();
	var renderer = new marked.Renderer(options);
	var slugs = Object.create(null);

	// id заголовков — как на GitHub: на них ссылаются [к разделу](#раздел)
	renderer.heading = function (token) {
		var id = headingSlug(this.parser.parseInline(token.tokens, this.parser.textRenderer), slugs);

		return '<h' + token.depth + ' id="' + id + '">' + this.parser.parseInline(token.tokens) + '</h' + token.depth + '>\n';
	};

	// раскрашенный код — уже HTML, экранировать его нельзя
	renderer.code = function (token) {
		var lang = /^\S*/.exec(token.lang || '')[0];
		var out = highlight ? highlight(token.text, lang) : null;

		return marked.Renderer.prototype.code.call(this, out == null ? token : { text: out, lang: token.lang, escaped: true });
	};

	options.renderer = renderer;

	// marked так же приводит переводы строк — куски ищем в том же виде
	var source = hideFrontMatter(text.replace(/\r\n|\r/g, '\n'));
	var tokens = marked.lexer(source, options);
	// один разборщик на все блоки
	var parser = new marked.Parser(options);
	var lines = blockLines(source, tokens);
	var html = '';

	for (var i = 0; i < tokens.length; i++) {
		if (tokens[i].type === 'space') {
			continue;
		}

		var out = parser.parse([tokens[i]]);

		if (tokens[i].type !== 'html' && lines[i]) {
			out = out.replace(/^<([a-z][a-z0-9]*)/, '<$1 ' + MARKDOWN_LINE_ATTR + '="' + lines[i] + '"');
		}

		html += out;
	}

	return html;
}

// Где начинается каждый блок. Сырые куски блоков идут по тексту почти
// подряд, но marked иногда склеивает соседние блоки или дописывает
// к куску перевод строки. Поэтому ищем кусок от конца предыдущего,
// а не складываем длины
function blockLines (source, tokens) {
	var result = [];
	var at = 0;
	var line = 1;

	for (var i = 0; i < tokens.length; i++) {
		var match = tokens[i].raw || '';
		var found = match ? source.indexOf(match, at) : -1;

		if (found < 0) {
			// склеенный кусок — хватит его первой строки
			match = match.split('\n')[0];
			found = match ? source.indexOf(match, at) : -1;
		}

		if (found < 0) {
			result.push(0);
			continue;
		}

		line += countLines(source, at, found);
		result.push(line);
		line += countLines(source, found, found + match.length);
		at = found + match.length;
	}

	return result;
}

function countLines (text, from, to) {
	var count = 0;

	for (var i = text.indexOf('\n', from); i !== -1 && i < to; i = text.indexOf('\n', i + 1)) {
		count++;
	}

	return count;
}

// Метаданные в начале файла не показываем — как превью VS Code. Строки
// оставляем пустыми, а не вырезаем: иначе номера строк блоков съедут
function hideFrontMatter (text) {
	var match = /^---[ \t]*\n(?:.*\n)*?(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(text);

	if (!match) {
		return text;
	}

	return match[0].replace(/[^\n]/g, '') + text.slice(match[0].length);
}

// id заголовка как у GitHub: строчные, без знаков, пробелы — дефисы;
// повтор получает -1, -2
function headingSlug (text, seen) {
	var base = unescapeHtml(text).toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
	var slug = base;

	while (slug in seen) {
		seen[base]++;
		slug = base + '-' + seen[base];
	}

	seen[slug] = 0;

	return slug;
}

function unescapeHtml (text) {
	return text
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, '\'')
		.replace(/&amp;/g, '&');
}

// Язык Монако по подписи блока: ```js, ```bash, ```yml. Сначала точное
// имя, потом псевдонимы и расширения — чтобы «html» не ушёл к языку,
// у которого html — одно из расширений
function findMonacoLanguage (languages, name) {
	var wanted = String(name || '').toLowerCase();

	if (!wanted) {
		return '';
	}

	for (var i = 0; i < languages.length; i++) {
		if (languages[i].id === wanted) {
			return languages[i].id;
		}
	}

	for (var j = 0; j < languages.length; j++) {
		if (hasName(languages[j].aliases, wanted) || hasName(languages[j].extensions, '.' + wanted)) {
			return languages[j].id;
		}
	}

	return '';
}

function hasName (list, wanted) {
	return !!list && list.some(function (item) {
		return String(item).toLowerCase() === wanted;
	});
}

// colorize рисует строки для редактора: неразрывные пробелы и <br/> после
// каждой строки. В <pre> хватит обычных пробелов — иначе скопированный
// из превью код был бы с неразрывными
function cleanColorized (html) {
	return html.replace(/<br\/>$/, '').replace(/&#160;|&nbsp;| /g, ' ');
}

// Куда прокрутить превью, чтобы наверху был тот же блок, что в редакторе.
// anchors — [{ line, top }] по возрастанию; внутри блока — пропорционально
function previewScrollTarget (anchors, line, lineCount, height) {
	var from = { line: 1, top: 0 };
	var to = { line: lineCount + 1, top: height };

	for (var i = 0; i < anchors.length; i++) {
		if (anchors[i].line <= line) {
			from = anchors[i];
		}
		else {
			to = anchors[i];
			break;
		}
	}

	if (to.line <= from.line) {
		return from.top;
	}

	return from.top + (to.top - from.top) * Math.min(1, (line - from.line) / (to.line - from.line));
}

// Обратное: какая строка исходника наверху превью, прокрученного на top.
// Блоки с одной высотой — наверху последний из них
function previewSourceLine (anchors, top, lineCount, height) {
	var from = { line: 1, top: 0 };
	var to = { line: lineCount + 1, top: height };

	for (var i = 0; i < anchors.length; i++) {
		if (anchors[i].top <= top) {
			from = anchors[i];
		}
		else {
			to = anchors[i];
			break;
		}
	}

	if (to.top <= from.top) {
		return from.line;
	}

	return from.line + (to.line - from.line) * Math.min(1, (top - from.top) / (to.top - from.top));
}

// Страница превью. Тёмная, как vs-dark в редакторе: иначе раскраска кода,
// подобранная под тёмный фон, на светлом не читалась бы. Плавную прокрутку
// из стилей текста глушит атрибут на <html>: он сильнее любого их правила.
// Иначе наша прокрутка растянулась бы на кадры, и каждый кадр казался бы
// прокруткой пользователя
var PREVIEW_PAGE = [
	'<!DOCTYPE html>',
	'<html style="scroll-behavior: auto !important">',
	'<head>',
	'<meta charset="utf-8">',
	'<meta name="referrer" content="no-referrer">',
	'<style>',
	'html { color-scheme: dark; }',
	'body { margin: 0; padding: 12px 24px 24px; background: #1e1e1e; color: #d4d4d4;',
	'	font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; overflow-wrap: break-word; }',
	'a { color: #3794ff; text-decoration: none; }',
	'a:hover { text-decoration: underline; }',
	'h1, h2, h3, h4, h5, h6 { margin: 1.2em 0 .6em; font-weight: 600; line-height: 1.25; }',
	'h1, h2 { padding-bottom: .3em; border-bottom: 1px solid #3c3c3c; }',
	'h1 { font-size: 2em; }',
	'h2 { font-size: 1.5em; }',
	'h3 { font-size: 1.25em; }',
	'h4 { font-size: 1em; }',
	'h5 { font-size: .875em; }',
	'h6 { font-size: .85em; color: #a0a0a0; }',
	'p, ul, ol, dl, blockquote, pre, table, details { margin: 0 0 1em; }',
	'body > :first-child { margin-top: 0; }',
	'ul, ol { padding-left: 2em; }',
	'li + li { margin-top: .25em; }',
	'li > p { margin: .5em 0; }',
	'blockquote { padding: 0 1em; color: #a0a0a0; border-left: 4px solid #3c3c3c; }',
	'hr { height: 2px; margin: 1.5em 0; border: 0; background: #3c3c3c; }',
	'code, pre, kbd, samp { font-family: "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; font-size: 13px; }',
	':not(pre) > code { padding: .15em .4em; border-radius: 4px; background: rgba(255, 255, 255, .1); }',
	'pre { padding: 12px 16px; border-radius: 4px; background: #252526; line-height: 1.45; overflow: auto; }',
	'kbd { padding: .1em .4em; border: 1px solid #555; border-bottom-width: 2px; border-radius: 4px; background: #2d2d2d; }',
	'table { display: block; max-width: 100%; border-collapse: collapse; overflow: auto; }',
	'th, td { padding: 6px 13px; border: 1px solid #3c3c3c; }',
	'th { font-weight: 600; }',
	'tr:nth-child(2n) { background: rgba(255, 255, 255, .03); }',
	'img { max-width: 100%; }',
	'input[type=checkbox] { margin: 0 .4em 0 -.2em; vertical-align: middle; }',
	'</style>',
	'<style id="tokens"></style>',
	'</head>',
	'<body></body>',
	'</html>',
].join('\n');

attachMarkdownPreview.markdownToHtml = markdownToHtml;
attachMarkdownPreview.findMonacoLanguage = findMonacoLanguage;
attachMarkdownPreview.cleanColorized = cleanColorized;
attachMarkdownPreview.previewScrollTarget = previewScrollTarget;
attachMarkdownPreview.previewSourceLine = previewSourceLine;
