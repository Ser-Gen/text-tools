// первая значимая строка текста — в заголовок вкладки,
// чтобы такую вкладку было легче найти

var PAGE_TITLE_MAX_LENGTH = 50;

// принимает тексты по порядку: заголовок берётся из первого непустого
function updatePageTitle (texts, suffix) {
	var list = Array.isArray(texts) ? texts : [texts];
	var piece = '';

	for (var i = 0; i < list.length; i++) {
		piece = firstMeaningfulLine(list[i]);

		if (piece) {
			break;
		}
	}

	document.title = piece
		? piece +' — '+ suffix
		: suffix;
}

function firstMeaningfulLine (text) {
	var lines = String(text || '').split('\n');

	for (var i = 0; i < lines.length; i++) {
		// пробелы, табы и знаки препинания сами по себе строку значимой не делают
		var line = lines[i].replace(/\s+/g, ' ').trim();

		if (!line || !line.match(/[\p{L}\p{N}]/u)) {
			continue;
		}

		if (line.length > PAGE_TITLE_MAX_LENGTH) {
			return line.slice(0, PAGE_TITLE_MAX_LENGTH).trimEnd() +'…';
		}

		return line;
	}

	return '';
}
