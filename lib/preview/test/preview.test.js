// Превью markdown: разметка с номерами строк, подписи языков, прокрутка.
// marked — настоящий, тот самый файл из vendor/, что уходит на сайт.
// Запуск: npm test (из папки lib/preview, после npm run vendor)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = { console };

vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'preview.js'), 'utf8'), context);

const preview = context.attachMarkdownPreview;
const marked = require('../vendor/marked.umd.js');
let failures = 0;

function test (name, fn) {
	try {
		fn();
		console.log('  ok   ' + name);
	}
	catch (e) {
		failures++;
		console.log('  FAIL ' + name + '\n       ' + e.message);
	}
}

function toHtml (text, highlight) {
	return preview.markdownToHtml(marked, text, highlight);
}

// «тег:строка» для каждого блока с номером
function blocks (html) {
	return [...html.matchAll(/<([a-z0-9]+) data-pasta-line="(\d+)"/g)].map(m => m[1] + ':' + m[2]);
}

// настоящие записи языков Монако 0.29 (из editor.main.js), и одна выдуманная:
// язык, который до html объявляет расширение .html
const LANGUAGES = [
	{ id: 'plaintext', aliases: ['Plain Text', 'text'], extensions: ['.txt'] },
	{ id: 'handlebars', aliases: ['Handlebars', 'handlebars', 'hbs'], extensions: ['.handlebars', '.hbs', '.html'] },
	{ id: 'javascript', aliases: ['JavaScript', 'javascript', 'js'], extensions: ['.js', '.es6', '.jsx', '.mjs'] },
	{ id: 'shell', aliases: ['Shell', 'sh'], extensions: ['.sh', '.bash'] },
	{ id: 'yaml', aliases: ['YAML', 'yaml', 'YML', 'yml'], extensions: ['.yaml', '.yml'] },
	{ id: 'html', aliases: ['HTML', 'htm', 'html', 'xhtml'], extensions: ['.html', '.htm', '.shtml', '.xhtml'] },
	{ id: 'python', aliases: ['Python', 'py'], extensions: ['.py', '.rpy', '.pyw'] },
	{ id: 'cpp', aliases: ['C++', 'Cpp', 'cpp'], extensions: ['.cpp', '.cc', '.cxx'] },
];

console.log('\nномера строк');

test('у каждого блока — его первая строка', () => {
	const html = toHtml([
		'# Заголовок',
		'',
		'Абзац',
		'на две строки',
		'',
		'- пункт',
		'- пункт',
		'',
		'```js',
		'var a;',
		'```',
		'',
		'> цитата',
		'',
		'---',
		'',
		'| a | b |',
		'|---|---|',
		'| 1 | 2 |',
	].join('\n'));

	assert.deepStrictEqual(blocks(html), ['h1:1', 'p:3', 'ul:6', 'pre:9', 'blockquote:13', 'hr:15', 'table:17']);
});

test('табы и определения ссылок счёт не сбивают', () => {
	const html = toHtml([
		'[ссылка]: https://example.com',
		'',
		'\tкод с табом',
		'',
		'Текст [ссылка]',
		'[другая]: /x',
		'',
		'## Ниже',
	].join('\n'));

	assert.deepStrictEqual(blocks(html), ['pre:3', 'p:5', 'h2:8']);
	assert.ok(html.includes('href="https://example.com"'), 'ссылка по определению: ' + html);
});

test('подчёркнутый заголовок и пустые строки подряд', () => {
	const html = toHtml('\n\n\nЗаголовок\n=========\n\n\n\nтекст');

	assert.deepStrictEqual(blocks(html), ['h1:4', 'p:9']);
});

test('сырой HTML без номера, а блоки внутри — с номерами', () => {
	const html = toHtml([
		'<details>',
		'<summary>Ещё</summary>',
		'',
		'Скрытый **текст**',
		'',
		'</details>',
	].join('\n'));

	assert.deepStrictEqual(blocks(html), ['p:4']);
	assert.ok(/<details>[\s\S]*<p data-pasta-line="4">Скрытый <strong>текст<\/strong><\/p>[\s\S]*<\/details>/.test(html), html);
});

test('front matter не показывается, строки не съезжают', () => {
	const html = toHtml('---\ntitle: Превет\ntags: [a]\n---\n# Заголовок\n\n---\n\nтекст');

	assert.ok(!html.includes('title'), 'метаданные видны: ' + html);
	assert.deepStrictEqual(blocks(html), ['h1:5', 'hr:7', 'p:9']);
});

test('незакрытый front matter — обычный текст', () => {
	const html = toHtml('---\nпросто текст');

	assert.deepStrictEqual(blocks(html), ['hr:1', 'p:2']);
});

console.log('\nразметка');

test('id заголовков — как на GitHub, повторы с номером', () => {
	const html = toHtml('# Раздел\n\n# Раздел\n\n## Что нового? (v2.0) & **ещё**');

	assert.ok(html.includes('<h1 data-pasta-line="1" id="раздел">Раздел</h1>'), html);
	assert.ok(html.includes('id="раздел-1"'), html);
	assert.ok(html.includes('id="что-нового-v20--ещё"'), html);
});

test('таблицы, задачи, зачёркивание, автоссылки', () => {
	const html = toHtml('- [x] сделано\n- [ ] нет\n\n~~старое~~ https://example.com и почта a@b.ru');

	assert.ok(html.includes('<input checked="" disabled="" type="checkbox">'), html);
	assert.ok(html.includes('<del>старое</del>'), html);
	assert.ok(html.includes('<a href="https://example.com">'), html);
	assert.ok(html.includes('<a href="mailto:a@b.ru">a@b.ru</a>'), 'почта не должна шифроваться: ' + html);
});

test('общие настройки marked не действуют', () => {
	// настройки у каждого вызова свои: чужой setOptions их не меняет
	marked.setOptions({ breaks: true });

	try {
		assert.ok(!toHtml('строка\nещё').includes('<br>'));
	}
	finally {
		marked.setOptions(marked.getDefaults());
	}
});

console.log('\nподсветка');

test('подпись и код доходят, ответ не экранируется', () => {
	const calls = [];
	const html = toHtml('```js\nvar a = 1;\n```\n\n```\n<b>\n```', (code, lang) => {
		calls.push(lang + ':' + code);
		return lang === 'js' ? '<span class="mtk5">' + code + '</span>' : null;
	});

	assert.deepStrictEqual(calls, ['js:var a = 1;', ':<b>']);
	assert.ok(html.includes('<code class="language-js"><span class="mtk5">var a = 1;</span>'), html);
	assert.ok(html.includes('&lt;b&gt;'), 'без подсветки код экранируется: ' + html);
});

test('код внутри списка тоже раскрашивается', () => {
	const calls = [];

	toHtml('- пункт\n\n  ```py\n  x = 1\n  ```', (code, lang) => {
		calls.push(lang + ':' + code);
		return null;
	});

	assert.deepStrictEqual(calls, ['py:x = 1']);
});

test('язык по подписи', () => {
	const find = (name) => preview.findMonacoLanguage(LANGUAGES, name);

	assert.strictEqual(find('js'), 'javascript');
	assert.strictEqual(find('JS'), 'javascript');
	assert.strictEqual(find('bash'), 'shell');
	assert.strictEqual(find('sh'), 'shell');
	assert.strictEqual(find('yml'), 'yaml');
	assert.strictEqual(find('py'), 'python');
	assert.strictEqual(find('c++'), 'cpp');
	assert.strictEqual(find('html'), 'html', 'точное имя главнее чужого расширения');
	assert.strictEqual(find('brainfuck'), '');
	assert.strictEqual(find(''), '');
});

test('раскраска Монако приводится к обычным пробелам', () => {
	assert.strictEqual(
		preview.cleanColorized('<span><span class="mtk1">a&#160;b c</span></span><br/><span></span><br/>'),
		'<span><span class="mtk1">a b c</span></span><br/><span></span>'
	);
});

console.log('\nпрокрутка');

test('внутри блока — пропорционально', () => {
	const anchors = [{ line: 1, top: 0 }, { line: 10, top: 500 }, { line: 20, top: 1500 }];
	const target = (line) => preview.previewScrollTarget(anchors, line, 29, 2400);

	assert.strictEqual(target(1), 0);
	assert.strictEqual(target(5.5), 250);
	assert.strictEqual(target(10), 500);
	assert.strictEqual(target(15), 1000);
	// после последнего блока — до конца превью
	assert.strictEqual(target(25), 1950);
});

test('без блоков — по всей высоте', () => {
	assert.strictEqual(preview.previewScrollTarget([], 11, 20, 2000), 1000);
});

test('до первого блока — от начала превью', () => {
	assert.strictEqual(preview.previewScrollTarget([{ line: 5, top: 300 }], 3, 10, 1000), 150);
});

test('обратно: верх превью — строка редактора', () => {
	const anchors = [{ line: 1, top: 0 }, { line: 10, top: 500 }, { line: 20, top: 1500 }];
	const line = (top) => preview.previewSourceLine(anchors, top, 29, 2400);

	assert.strictEqual(line(0), 1);
	assert.strictEqual(line(250), 5.5);
	assert.strictEqual(line(500), 10);
	assert.strictEqual(line(1000), 15);
	// после последнего блока — до конца текста
	assert.strictEqual(line(1950), 25);
	assert.strictEqual(preview.previewSourceLine([{ line: 5, top: 300 }], 150, 10, 1000), 3);
});

test('туда и обратно — та же строка', () => {
	// первый блок не с начала: отступ страницы и скрытый front matter
	const anchors = [{ line: 3, top: 12 }, { line: 4, top: 80 }, { line: 9, top: 90 }, { line: 30, top: 900 }];

	for (let line = 1; line <= 40; line += 0.25) {
		const top = preview.previewScrollTarget(anchors, line, 40, 1400);
		const back = preview.previewSourceLine(anchors, top, 40, 1400);

		assert.ok(Math.abs(back - line) < 1e-9, line + ' → ' + top + ' → ' + back);
	}
});

test('блоки на одной высоте — наверху последний', () => {
	const anchors = [{ line: 1, top: 0 }, { line: 5, top: 100 }, { line: 8, top: 100 }, { line: 12, top: 300 }];

	assert.strictEqual(preview.previewSourceLine(anchors, 100, 20, 1000), 8);
	assert.strictEqual(preview.previewSourceLine(anchors, 200, 20, 1000), 10);
});

console.log('\nскорость');

test('мегабайт markdown', () => {
	const section = [
		'## Раздел про **важное**',
		'',
		'Абзац с `кодом`, [ссылкой](https://example.com) и *выделением*. '.repeat(4),
		'',
		'- пункт один',
		'- пункт два с `кодом`',
		'',
		'```js',
		'function f (a) { return a * 2; }',
		'```',
		'',
		'| a | b |',
		'|---|---|',
		'| 1 | 2 |',
		'',
	].join('\n');
	const text = section.repeat(Math.ceil(1024 * 1024 / section.length));
	const lines = text.split('\n').length;

	toHtml('прогрев');

	const started = Date.now();
	const html = toHtml(text, () => null);
	const elapsed = Date.now() - started;
	const numbered = blocks(html);

	console.log('       ' + (text.length / 1024 | 0) + ' КБ, ' + lines + ' строк, ' + numbered.length + ' блоков, ' + elapsed + ' мс');
	assert.strictEqual(numbered[numbered.length - 1], 'table:' + (lines - 3), 'номер последнего блока');
	assert.ok(elapsed < 3000, 'слишком медленно: ' + elapsed + ' мс');
});

// ради этого marked свой: у marked 3 из сборки Монако каждый пункт заново
// перебирает весь хвост списка — 20 тысяч пунктов разбирались бы минуты
test('список на 20 тысяч пунктов', () => {
	const text = Array.from({ length: 20000 }, (_, i) => '- дело номер ' + i).join('\n');
	const started = Date.now();
	const html = toHtml(text);
	const elapsed = Date.now() - started;

	console.log('       ' + (text.length / 1024 | 0) + ' КБ, ' + elapsed + ' мс');
	assert.strictEqual(html.split('<li>').length - 1, 20000);
	assert.ok(elapsed < 1000, 'слишком медленно: ' + elapsed + ' мс');
});

// пункты с галочками и у marked 18 квадратичные (каждый ищет свой текст
// в очереди с конца), но пять тысяч — ещё терпимо
test('список дел на 5 тысяч пунктов', () => {
	const text = Array.from({ length: 5000 }, (_, i) => '- [' + (i % 2 ? 'x' : ' ') + '] дело номер ' + i).join('\n');
	const started = Date.now();
	const html = toHtml(text);
	const elapsed = Date.now() - started;

	console.log('       ' + (text.length / 1024 | 0) + ' КБ, ' + elapsed + ' мс');
	assert.strictEqual(html.split('type="checkbox"').length - 1, 5000);
	assert.strictEqual(html.split('checked=""').length - 1, 2500);
	assert.ok(elapsed < 2000, 'слишком медленно: ' + elapsed + ' мс');
});

console.log('\n' + (failures ? failures + ' проблем' : 'проблем не найдено'));
process.exit(failures ? 1 : 0);
