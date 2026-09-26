// Проверка строк словарями Hunspell. Откуда брать словари, решает
// вызывающий: воркер качает их fetch'ем, тесты читают с диска.
//
//   var checker = createChecker({
//     createDictionary: function (lang) { return Promise<{ testSpelling(word) }> },
//     onError: function (lang, error) {},
//   });
//   checker.check([{ n: 1, text: '...' }]) → Promise<[{ n, start, end, word, kind }]>

import { tokenize } from './words.js';

// проверенные слова помним: текст правят понемногу, и почти все слова
// при повторной проверке уже известны
var CACHE_LIMIT = 100000;

export function createChecker (opts) {
	var dictionaries = {};
	var cache = new Map();

	// словарь грузится, только когда в тексте встретился его алфавит
	function dictionary (lang) {
		if (!dictionaries[lang]) {
			dictionaries[lang] = opts.createDictionary(lang).catch(function (e) {
				if (opts.onError) {
					opts.onError(lang, e);
				}

				// без словаря молчим, а не подчёркиваем всё подряд
				return null;
			});
		}

		return dictionaries[lang];
	}

	function isCorrect (dict, token) {
		if (!dict) {
			return true;
		}

		var key = token.kind + ':' + token.lookup;
		var known = cache.get(key);

		if (known !== undefined) {
			return known;
		}

		var result = dict.testSpelling(token.lookup);

		if (cache.size >= CACHE_LIMIT) {
			cache.clear();
		}

		cache.set(key, result);

		return result;
	}

	// opts.markdown — строки из markdown: прятать разметку
	function check (lines, checkOpts) {
		var tokens = [];
		var langs = {};

		lines.forEach(function (line) {
			tokenize(line.text, checkOpts).forEach(function (token) {
				token.n = line.n;
				tokens.push(token);

				if (token.kind !== 'mixed') {
					langs[token.kind] = true;
				}
			});
		});

		var names = Object.keys(langs);

		return Promise.all(names.map(dictionary)).then(function (loaded) {
			var byLang = {};
			var issues = [];

			names.forEach(function (name, i) {
				byLang[name] = loaded[i];
			});

			tokens.forEach(function (token) {
				if (token.kind === 'mixed' || !isCorrect(byLang[token.kind], token)) {
					issues.push({
						n: token.n,
						start: token.start,
						end: token.end,
						word: token.word,
						kind: token.kind,
					});
				}
			});

			return issues;
		});
	}

	return {
		check: check,
	};
}
