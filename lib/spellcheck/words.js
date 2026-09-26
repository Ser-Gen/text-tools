// Разбор строки на слова для проверки орфографии: что проверять, каким
// словарём и что пропустить. Чистые функции без DOM и сети — их гоняют
// тесты (test/words.test.js) и воркер (через checker.js).
//
// В markdown дополнительно прячем разметку: код в строке, формулы, теги,
// сущности и адреса ссылок. Блоки ``` сюда не доходят: строки кода
// отсеивает страница (scanMarkdownLine в spellcheck.js), потому что
// воркеру видны не все строки, а начало блока может быть далеко выше.

// «Кусок» — то, что потом решаем проверять или нет: буквы, знаки ударения,
// цифры, подчёркивание, апостроф и дефис. Тот же набор повторён
// в spellcheck.js — там по нему ищут границы набираемого слова
export var CHUNK = /[\p{L}\p{M}\p{N}_'’-]+/gu;
// в markdown * ~ _ внутри слова — это выделение, а не граница:
// «пре**фикс**» — одно слово
var CHUNK_MD = /[\p{L}\p{M}\p{N}_'’*~-]+/gu;
var EDGES = /^['’-]+|['’-]+$/g;
var EDGES_MD = /^['’*~_-]+|['’*~_-]+$/g;
var MARKUP = /[*~_]/g;

var CYRILLIC = /\p{Script=Cyrillic}/u;
var LATIN = /\p{Script=Latin}/u;
var LETTER = /\p{L}/u;
var LOWER = /\p{Ll}/u;
var DIGIT_OR_UNDERSCORE = /[\p{N}_]/u;
// fooBar, getLineContent
var CAMEL = /\p{Ll}\p{Lu}/u;
// file.txt, example.com, т.е.
var DOTTED = /[\p{L}\p{N}]\.[\p{L}\p{N}]/u;
var EMAIL = /\S@\S/;
var PATH = /[\/\\]/;
var WWW = /^\W*www\./i;
// в словаре ударений нет: «за́мок» проверяем как «замок»
var STRESS = /[̀́]/g;

// Строка → слова с позициями (индексы в строке, конец не включается).
// kind: ru | en — каким словарём проверять; mixed — в слове смешаны
// кириллица и латиница, это ошибка без всякого словаря.
// opts.markdown — прятать разметку и считать * ~ _ частью слова
export function tokenize (line, opts) {
	var markdown = !!(opts && opts.markdown);
	// разметку заменяем пробелами, а не вырезаем: позиции должны совпадать
	// с настоящей строкой, по ним потом рисуются подчёркивания
	var text = markdown ? maskMarkdown(line) : line;
	var chunks = markdown ? CHUNK_MD : CHUNK;
	var result = [];
	var tokens = /\S+/g;
	var token;

	while ((token = tokens.exec(text))) {
		if (isSkippedToken(token[0])) {
			continue;
		}

		for (var chunk of token[0].matchAll(chunks)) {
			addWord(result, chunk[0], token.index + chunk.index, true, markdown);
		}
	}

	return result;
}

// ссылки, почта, пути и имена с точкой — не слова
function isSkippedToken (token) {
	return PATH.test(token)
		|| EMAIL.test(token)
		|| WWW.test(token)
		|| DOTTED.test(token);
}

function addWord (result, text, start, canSplit, markdown) {
	var edges = markdown ? EDGES_MD : EDGES;
	var lead = text.length - text.replace(markdown ? /^['’*~_-]+/ : /^['’-]+/, '').length;
	var word = text.replace(edges, '');

	start += lead;

	if (!isCheckable(word)) {
		return;
	}

	var lookup = word.replace(STRESS, '');

	if (markdown) {
		lookup = lookup.replace(MARKUP, '');
	}

	if (lookup.length < 2) {
		return;
	}

	var kind = scriptOf(lookup);

	if (!kind) {
		return;
	}

	// «IT-компания»: латиница и кириллица в разных частях через дефис —
	// так пишут, это не ошибка. Проверяем каждую часть отдельно
	if (kind === 'mixed' && canSplit && word.indexOf('-') > -1) {
		var offset = 0;

		word.split('-').forEach(function (part) {
			addWord(result, part, start + offset, false, markdown);
			offset += part.length + 1;
		});

		return;
	}

	result.push({
		start: start,
		end: start + word.length,
		word: word,
		lookup: lookup,
		kind: kind,
	});
}

function isCheckable (word) {
	if (word.length < 2) {
		return false;
	}

	// идентификаторы: v2, utf8, snake_case, camelCase
	if (DIGIT_OR_UNDERSCORE.test(word) || CAMEL.test(word)) {
		return false;
	}

	// ВСЕ ЗАГЛАВНЫЕ — сокращения и константы
	return LOWER.test(word);
}

function scriptOf (word) {
	var cyrillic = false;
	var latin = false;

	for (var ch of word) {
		if (CYRILLIC.test(ch)) {
			cyrillic = true;
		}
		else if (LATIN.test(ch)) {
			latin = true;
		}
		else if (LETTER.test(ch)) {
			// другие алфавиты не проверяем
			return null;
		}
	}

	if (cyrillic && latin) {
		return 'mixed';
	}

	return cyrillic ? 'ru' : latin ? 'en' : null;
}

// ——— разметка markdown ———————————————————————————————————————————————

// Прячем всё, что не проза. Порядок важен: сначала код и формулы, потом
// теги — тогда тег внутри `кода` уже спрятан и не мешает
function maskMarkdown (line) {
	var text = line;

	text = mask(text, /<!--[\s\S]*?-->/g);
	text = maskTail(text, /<!--/);
	// `код`, ``код с ` внутри``
	text = mask(text, /(`+)[\s\S]*?\1/g);
	text = maskTail(text, /`/);
	text = mask(text, /\$\$[\s\S]*?\$\$/g);
	text = mask(text, /\$[^$]*\$/g);
	text = mask(text, /&(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6});/g);
	// теги и автоссылки <http://…>; текст между тегами остаётся
	text = mask(text, /<\/?[a-zA-Z][^>]*>/g);
	// адрес ссылки и метка ссылки-ссылки: [текст](адрес), [текст][метка]
	text = maskGroup(text, /\]\(([^)]*)\)/g);
	text = maskGroup(text, /\]\[([^\]]*)\]/g);

	return text;
}

function spaces (length) {
	return new Array(length + 1).join(' ');
}

function mask (text, re) {
	return text.replace(re, function (match) {
		return spaces(match.length);
	});
}

// незакрытая разметка: прячем до конца строки
function maskTail (text, re) {
	var found = re.exec(text);

	if (!found) {
		return text;
	}

	return text.slice(0, found.index) + spaces(text.length - found.index);
}

function maskGroup (text, re) {
	return text.replace(re, function (match, group) {
		var at = match.indexOf(group);

		return match.slice(0, at) + spaces(group.length) + match.slice(at + group.length);
	});
}
