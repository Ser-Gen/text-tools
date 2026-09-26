// Воркер проверки орфографии. Модульный: hunspell-wasm — ES-модуль
// и сам находит hunspell.wasm рядом с собой через import.meta.url.
//
// ← { type: 'check', id, markdown, lines: [{ n, text }] }
// → { type: 'result', id, issues: [{ n, start, end, word, kind }], failed? }
// → { type: 'status', state: 'loading' | 'ready' | 'error', lang?, message? }

import { createChecker } from './checker.js';
import { createHunspellFromStrings } from './vendor/hunspell-wasm/dist/Hunspell.js';

var checker = createChecker({
	createDictionary: loadDictionary,
	onError: function (lang, e) {
		self.postMessage({ type: 'status', state: 'error', lang: lang, message: lang + ': ' + describe(e) });
	},
});

// запросы обрабатываем строго по очереди
var queue = Promise.resolve();

self.onmessage = function (event) {
	var message = event.data;

	if (!message || message.type !== 'check') {
		return;
	}

	queue = queue
		.then(function () {
			return checker.check(message.lines, { markdown: !!message.markdown });
		})
		.then(function (issues) {
			self.postMessage({ type: 'result', id: message.id, issues: issues });
		})
		.catch(function (e) {
			self.postMessage({ type: 'status', state: 'error', message: describe(e) });
			// ответ всё равно нужен: страница помечает строки как отправленные
			self.postMessage({ type: 'result', id: message.id, issues: [], failed: true });
		});
};

function loadDictionary (lang) {
	self.postMessage({ type: 'status', state: 'loading', lang: lang });

	return Promise.all([fetchText(lang + '.aff'), fetchText(lang + '.dic')])
		.then(function (files) {
			return createHunspellFromStrings(files[0], files[1]);
		})
		.then(function (hunspell) {
			self.postMessage({ type: 'status', state: 'ready', lang: lang });

			return hunspell;
		});
}

function fetchText (name) {
	return fetch(new URL('./dict/' + name, import.meta.url)).then(function (response) {
		if (!response.ok) {
			throw new Error(name + ' — ' + response.status);
		}

		return response.text();
	});
}

function describe (e) {
	return String(e && e.message || e);
}
