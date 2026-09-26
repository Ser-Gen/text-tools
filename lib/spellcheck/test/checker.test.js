// Проверка на настоящих словарях и настоящем hunspell-wasm — тех самых
// файлах из vendor/ и dict/, которые уходят на сайт.
// Запуск: npm test (из папки lib/spellcheck, после npm run vendor)

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChecker } from '../checker.js';
import { createHunspellFromStrings } from '../vendor/hunspell-wasm/dist/Hunspell.js';

var ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
var failures = 0;
var dictionaries = {};

// словари грузим один раз на все проверки: это самое долгое
function loadDictionary (lang) {
	if (!dictionaries[lang]) {
		dictionaries[lang] = createHunspellFromStrings(
			fs.readFileSync(path.join(ROOT, 'dict', lang + '.aff'), 'utf8'),
			fs.readFileSync(path.join(ROOT, 'dict', lang + '.dic'), 'utf8')
		);
	}

	return dictionaries[lang];
}

async function test (name, fn) {
	try {
		await fn();
		console.log('  ok   ' + name);
	}
	catch (e) {
		failures++;
		console.log('  FAIL ' + name + '\n       ' + e.message);
	}
}

async function wrong (text) {
	var checker = createChecker({ createDictionary: loadDictionary });
	var issues = await checker.check([{ n: 1, text: text }]);

	return issues.map(function (issue) {
		return issue.word;
	});
}

console.log('\nнастоящие словари');

await test('опечатка в русском', async () => {
	assert.deepStrictEqual(await wrong('Привет, это праверка орфографии'), ['праверка']);
});

await test('опечатки в английском', async () => {
	assert.deepStrictEqual(await wrong('I recieve teh message'), ['recieve', 'teh']);
});

await test('е и ё — обе формы верны', async () => {
	assert.deepStrictEqual(await wrong('ёлка елка ещё еще всё все'), []);
});

await test('имя собственное со строчной — ошибка', async () => {
	assert.deepStrictEqual(await wrong('москва Москва'), ['москва']);
});

await test('дефисы и апострофы', async () => {
	assert.deepStrictEqual(await wrong('кто-нибудь из-за IT-компания e-mail don’t'), []);
	assert.deepStrictEqual(await wrong('кто-нибуть'), ['кто-нибуть']);
});

await test('ударение', async () => {
	assert.deepStrictEqual(await wrong('за́мок'), []);
});

await test('смешанные алфавиты подчёркиваются без словаря', async () => {
	var checker = createChecker({ createDictionary: loadDictionary });
	var issues = await checker.check([{ n: 1, text: 'русcкий' }]);

	assert.strictEqual(issues.length, 1);
	assert.strictEqual(issues[0].kind, 'mixed');
});

await test('номера строк и позиции доходят до ответа', async () => {
	var checker = createChecker({ createDictionary: loadDictionary });
	var issues = await checker.check([
		{ n: 7, text: 'всё верно' },
		{ n: 9, text: 'тут ашибка' },
	]);

	assert.deepStrictEqual(issues, [{ n: 9, start: 4, end: 10, word: 'ашибка', kind: 'ru' }]);
});

console.log('\nmarkdown');

await test('разметку не проверяем, прозу проверяем', async () => {
	var checker = createChecker({ createDictionary: loadDictionary });
	var issues = await checker.check([
		{ n: 1, text: '# Заголовок про праверку' },
		{ n: 2, text: 'текст с `превет` внутри и [ссылка](/путь/превет)' },
		{ n: 3, text: 'а тут **ашибка**' },
	], { markdown: true });

	assert.deepStrictEqual(issues.map(i => i.n + ':' + i.word), ['1:праверку', '3:ашибка']);
});

await test('без markdown разметка проверяется как обычный текст', async () => {
	assert.deepStrictEqual(await wrong('текст с `превет` внутри'), ['превет']);
});

console.log('\nзагрузка словарей');

await test('словарь грузится только для встреченного алфавита и один раз', async () => {
	var loads = [];
	var checker = createChecker({
		createDictionary: function (lang) {
			loads.push(lang);
			return loadDictionary(lang);
		},
	});

	await checker.check([{ n: 1, text: 'только русский' }]);
	assert.deepStrictEqual(loads, ['ru']);

	await checker.check([{ n: 1, text: 'снова русский and English' }]);
	assert.deepStrictEqual(loads, ['ru', 'en']);
});

await test('не загрузился словарь — не подчёркиваем, а сообщаем', async () => {
	var errors = [];
	var checker = createChecker({
		createDictionary: function (lang) {
			return lang === 'en' ? Promise.reject(new Error('offline')) : loadDictionary(lang);
		},
		onError: function (lang) {
			errors.push(lang);
		},
	});
	var issues = await checker.check([{ n: 1, text: 'teh ашибка' }]);

	assert.deepStrictEqual(issues.map(i => i.word), ['ашибка']);
	assert.deepStrictEqual(errors, ['en']);
});

console.log('\nскорость');

await test('полмегабайта смешанного текста', async () => {
	var checker = createChecker({ createDictionary: loadDictionary });
	var lines = [];

	await checker.check([{ n: 1, text: 'прогрев and warm up' }]);

	for (var i = 0; i < 10000; i++) {
		lines.push({ n: i + 1, text: 'Строка про праверку орфографии and some English words here, номер ' + i });
	}

	var started = performance.now();
	var issues = await checker.check(lines);
	var elapsed = performance.now() - started;

	console.log('       ' + lines.length + ' строк, ' + issues.length + ' ошибок, ' + elapsed.toFixed(0) + ' мс');
	assert.strictEqual(issues.length, 10000);
	assert.ok(elapsed < 5000, 'слишком медленно: ' + elapsed.toFixed(0) + ' мс');
});

console.log('\n' + (failures ? failures + ' проблем' : 'проблем не найдено'));
process.exit(failures ? 1 : 0);
