// Копирует marked из node_modules туда, откуда его грузит страница.
// Сборки нет: файлы кладутся как есть и уходят на сайт.
// Запуск (из папки lib/preview): npm install && npm run vendor
//
// Свой marked, а не тот, что в сборке Монако: у того (3.x) разбор списка
// квадратичный — список дел на пару тысяч пунктов разбирался бы секундами
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MARKED = path.join(ROOT, 'node_modules', 'marked');
const VENDOR = path.join(ROOT, 'vendor');

function copy (from, to) {
	fs.mkdirSync(path.dirname(to), { recursive: true });
	fs.copyFileSync(from, to);
	console.log('  ' + path.relative(ROOT, to));
}

fs.rmSync(VENDOR, { recursive: true, force: true });

// UMD объявляет себя AMD-модулем «marked» — его и просит превью у загрузчика
// Монако. Карта — чтобы девтулзы не ругались на её отсутствие
['marked.umd.js', 'marked.umd.js.map'].forEach(function (name) {
	copy(path.join(MARKED, 'lib', name), path.join(VENDOR, name));
});

copy(path.join(MARKED, 'LICENSE'), path.join(VENDOR, 'marked.LICENSE'));
