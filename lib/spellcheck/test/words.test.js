// Разбор строки на слова: что проверяем, каким словарём, что пропускаем.
// Запуск: npm test (из папки lib/spellcheck)

import assert from 'node:assert';
import { tokenize } from '../words.js';

var failures = 0;

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

function words (line) {
	return tokenize(line).map(function (t) {
		return t.word + ':' + t.kind;
	});
}

console.log('\nслова');

test('русский и английский расходятся по словарям', () => {
	assert.deepStrictEqual(words('Привет, мир! Hello world'), ['Привет:ru', 'мир:ru', 'Hello:en', 'world:en']);
});

test('позиции — индексы в строке, конец не включается', () => {
	var token = tokenize('  «Превет»')[0];
	assert.strictEqual(token.start, 3);
	assert.strictEqual(token.end, 9);
});

test('дефисные слова целиком: Hunspell сам их разбирает', () => {
	assert.deepStrictEqual(words('кто-нибудь e-mail'), ['кто-нибудь:ru', 'e-mail:en']);
});

test('дефисы и апострофы по краям отрезаются', () => {
	assert.deepStrictEqual(words("-слово- «users'»"), ['слово:ru', 'users:en']);
	assert.strictEqual(tokenize('-слово-')[0].start, 1);
});

test('апостроф внутри слова остаётся', () => {
	assert.deepStrictEqual(words('don’t it\'s'), ['don’t:en', "it's:en"]);
});

test('ударение не мешает проверке, но позиции прежние', () => {
	var token = tokenize('за\u0301мок')[0];
	assert.strictEqual(token.word, 'за\u0301мок');
	assert.strictEqual(token.lookup, 'замок');
	assert.strictEqual(token.end, 6);
});

test('ё не трогаем: словарь знает обе формы', () => {
	assert.strictEqual(tokenize('ёлка')[0].lookup, 'ёлка');
});

console.log('\nпропускаем');

test('ссылки', () => {
	assert.deepStrictEqual(words('см. https://example.com/путь и www.site.ru'), ['см:ru']);
});

test('почта', () => {
	assert.deepStrictEqual(words('пишите user@mail.ru или admin@localhost'), ['пишите:ru', 'или:ru']);
});

test('пути', () => {
	assert.deepStrictEqual(words('/usr/lib C:\\Windows ./run.sh ~/docs и/или'), []);
});

test('имена с точкой: файлы, домены, т.е.', () => {
	assert.deepStrictEqual(words('file.txt example.com т.е. конец.'), ['конец:ru']);
});

test('идентификаторы', () => {
	assert.deepStrictEqual(words('fooBar snake_case v2 utf8 x86 2024-й getLineContent'), []);
});

test('ВСЕ ЗАГЛАВНЫЕ', () => {
	assert.deepStrictEqual(words('HTTP ГОСТ ЭТО-ТО MAX'), []);
});

test('одна буква', () => {
	assert.deepStrictEqual(words('я и I a'), []);
});

test('другие алфавиты', () => {
	assert.deepStrictEqual(words('αβγ 中文 Ελληνικά'), []);
});

console.log('\nсмешанные алфавиты');

test('латинская c внутри русского слова — ошибка', () => {
	// \u0063 — латинская c
	assert.deepStrictEqual(words('рус\u0063кий'), ['рус\u0063кий:mixed']);
});

test('латиница и кириллица через дефис — не ошибка, части по отдельности', () => {
	var tokens = tokenize('IT-компания SMS-сообщение');
	assert.deepStrictEqual(tokens.map(t => t.word + ':' + t.kind), ['компания:ru', 'сообщение:ru']);
	assert.strictEqual(tokens[0].start, 3);
	assert.strictEqual(tokens[1].start, 16);
});

test('смешанная часть через дефис — ошибка только в ней', () => {
	var tokens = tokenize('интернет-мaгазин');
	assert.deepStrictEqual(tokens.map(t => t.word + ':' + t.kind), ['интернет:ru', 'мaгазин:mixed']);
	assert.strictEqual(tokens[1].start, 9);
});

console.log('\nmarkdown');

function md (line) {
	return tokenize(line, { markdown: true }).map(function (t) {
		return t.word + ':' + t.kind;
	});
}

test('код в строке не проверяется', () => {
	assert.deepStrictEqual(md('текст `превет` и ещё'), ['текст:ru', 'ещё:ru']);
	assert.deepStrictEqual(md('``превет`` и `ещё`'), []);
});

test('незакрытая кавычка прячет остаток строки', () => {
	assert.deepStrictEqual(md('текст `превет и ещё'), ['текст:ru']);
});

test('формулы', () => {
	assert.deepStrictEqual(md('было $превет + x$ ещё'), ['было:ru', 'ещё:ru']);
});

test('сущности', () => {
	assert.deepStrictEqual(md('слово&nbsp;слово &mdash; ещё'), ['слово:ru', 'слово:ru', 'ещё:ru']);
});

test('теги прячутся, текст между ними проверяется', () => {
	assert.deepStrictEqual(md('<div class="превет">текст</div>'), ['текст:ru']);
	assert.deepStrictEqual(md('<!-- превет --> текст'), ['текст:ru']);
});

test('адрес ссылки прячется, текст ссылки проверяется', () => {
	assert.deepStrictEqual(md('[превет](/путь/файл) и [текст][метка]'), ['превет:ru', 'текст:ru']);
});

test('выделение внутри слова не рвёт слово', () => {
	var tokens = tokenize('пре**фикс** и **важно**', { markdown: true });
	assert.deepStrictEqual(tokens.map(t => t.word + '→' + t.lookup), ['пре**фикс→префикс', 'важно→важно']);
});

test('позиции не съезжают: разметка заменяется пробелами', () => {
	var token = tokenize('`код` превет', { markdown: true })[0];
	assert.strictEqual(token.word, 'превет');
	assert.strictEqual(token.start, 6);
});

test('в plaintext звёздочки остаются границей слова', () => {
	assert.deepStrictEqual(words('пре**фикс'), ['пре:ru', 'фикс:ru']);
});

console.log('\n' + (failures ? failures + ' проблем' : 'проблем не найдено'));
process.exit(failures ? 1 : 0);
