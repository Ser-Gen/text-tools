// Копирует hunspell-wasm и словари из node_modules туда, откуда их грузит
// страница. Сборки нет: файлы кладутся как есть и уходят на сайт.
// Запуск (из папки lib/spellcheck): npm install && npm run vendor

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

var ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
var MODULES = path.join(ROOT, 'node_modules');
var WASM = path.join(MODULES, 'hunspell-wasm');
var VENDOR = path.join(ROOT, 'vendor', 'hunspell-wasm');
var DICT = path.join(ROOT, 'dict');

function copy (from, to) {
	fs.mkdirSync(path.dirname(to), { recursive: true });
	fs.copyFileSync(from, to);
	console.log('  ' + path.relative(ROOT, to));
}

fs.rmSync(VENDOR, { recursive: true, force: true });
fs.rmSync(DICT, { recursive: true, force: true });

// dist и wasm обязаны лежать рядом: dist/Hunspell.js грузит '../wasm/hunspell.js',
// а тот ищет hunspell.wasm возле себя через import.meta.url
fs.readdirSync(path.join(WASM, 'dist'))
	.filter(function (name) {
		return name.endsWith('.js') && name !== 'Test.js';
	})
	.forEach(function (name) {
		copy(path.join(WASM, 'dist', name), path.join(VENDOR, 'dist', name));
	});

['hunspell.js', 'hunspell.wasm'].forEach(function (name) {
	copy(path.join(WASM, 'wasm', name), path.join(VENDOR, 'wasm', name));
});

['COPYING', 'COPYING.LESSER', 'COPYING.MPL'].forEach(function (name) {
	copy(path.join(WASM, name), path.join(VENDOR, name));
});

['ru', 'en'].forEach(function (lang) {
	var from = path.join(MODULES, 'dictionary-' + lang);

	copy(path.join(from, 'index.aff'), path.join(DICT, lang + '.aff'));
	copy(path.join(from, 'index.dic'), path.join(DICT, lang + '.dic'));
	copy(path.join(from, 'license'), path.join(DICT, lang + '.license'));
});
