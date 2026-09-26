// Разметка блоков markdown: какие строки целиком не проверяются.
// Считает её страница (spellcheck.js), потому что воркеру видны не все
// строки, а начало блока ``` может быть далеко выше видимого.
// Запуск: npm test (из папки lib/spellcheck)

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

var ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
var context = {};

vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'spellcheck.js'), 'utf8'), context);

var scanMarkdownLine = context.attachSpellcheck.scanMarkdownLine;
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

// текст → строка из «п» (проза) и «к» (код или метаданные)
function scan (text) {
	var state = null;

	return text.split('\n').map(function (line, i) {
		var step = scanMarkdownLine(state, line, i + 1);

		state = step.state;

		return step.code ? 'к' : 'п';
	}).join('');
}

console.log('\nблоки markdown');

test('обычная проза — вся проверяется', () => {
	assert.strictEqual(scan('# Заголовок\n\nтекст и ещё текст'), 'ппп');
});

test('блок ``` вместе с границами не проверяется', () => {
	assert.strictEqual(scan('до\n```js\nпревет\n```\nпосле'), 'пкккп');
});

test('блок ~~~ тоже', () => {
	assert.strictEqual(scan('до\n~~~\nпревет\n~~~\nпосле'), 'пкккп');
});

test('внутри блока чужие заборы не закрывают его', () => {
	assert.strictEqual(scan('````\n```\nпревет\n````\nпосле'), 'ккккп');
});

test('забор покороче не закрывает длинный', () => {
	assert.strictEqual(scan('~~~~\n~~~\n~~~~\nпосле'), 'кккп');
});

test('забор с отступом — например, в списке', () => {
	assert.strictEqual(scan('- пункт\n\n    ```\n    превет\n    ```\nпосле'), 'ппкккп');
});

test('незакрытый забор съедает остаток текста', () => {
	assert.strictEqual(scan('до\n```\nпревет\nи ещё'), 'пккк');
});

test('``` посреди строки — не забор', () => {
	assert.strictEqual(scan('текст ``` текст\nещё'), 'пп');
});

console.log('\nметаданные');

test('front matter в начале файла не проверяется', () => {
	assert.strictEqual(scan('---\ntitle: Превет\n---\nтекст'), 'кккп');
});

test('front matter закрывается и точками', () => {
	assert.strictEqual(scan('---\ntitle: x\n...\nтекст'), 'кккп');
});

test('--- не в первой строке — это разделитель, а не метаданные', () => {
	assert.strictEqual(scan('текст\n---\nещё текст'), 'ппп');
});

console.log('\n' + (failures ? failures + ' проблем' : 'проблем не найдено'));
process.exit(failures ? 1 : 0);
