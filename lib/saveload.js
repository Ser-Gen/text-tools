function load () {
	return new Promise(function (resolve, reject) {
		var hash = location.hash;

		if (
			!hash
			|| !hash.match('data=')
		) {
			location.hash = '';
			reject();
			return;
		}

		var data = hash.split('data=')[1];

		base64ToBufferAsync(data).then(function (buffer) {
			var decompressedFflate = fflate.decompressSync(new Uint8Array(buffer));
			var dataString = fflate.strFromU8(decompressedFflate);
			var data = JSON.parse(dataString);

			resolve(data);
		}, alert).catch(reject);
	})
}

function save (cfg) {
	var data = {
		type: cfg.type,
		texts: cfg.texts,
		mode: cfg.mode || 'plaintext',
	}

	if (typeof cfg.opts !== 'undefined') {
		data.opts = cfg.opts;
	}
	
	try {
		var dataString = JSON.stringify(data);
		var buf = fflate.strToU8(dataString);
		var encoded = fflate.compressSync(buf, {
			level: 6, mem: 8
		});

		bufferToBase64Async(encoded.buffer).then(function (base64) {
			location.hash = 'data='+ base64;
		});
	}
	catch (e) {
		alert('Сохранить не удалось, смотрите консоль');
		throw e;
	}
}

function base64ToBufferAsync(base64) {
	return new Promise(function (resolve, reject) {
		var dataUrl = "data:application/octet-binary;base64," + base64;

		fetch(dataUrl)
			.then(res => res.arrayBuffer())
			.then(buffer => {
				resolve(buffer);
			})
			.catch(reject)
	});
}

function bufferToBase64Async(buffer) {
	return new Promise(function (resolve, reject) {
		var blob = new Blob([buffer], {
			type: 'application/octet-binary'
		});
		var fileReader = new FileReader();

		fileReader.onload = function() {
			var dataUrl = fileReader.result;
			var base64 = dataUrl.substr(dataUrl.indexOf(',') + 1);

			resolve(base64);
		}
		fileReader.readAsDataURL(blob);
	})
}


// уменьшение количества вызовов
function debounce (func, wait, immediate) {
	var timeout;

	return function() {
		var context = this;
		var later = function() {
			timeout = null;
			if (!immediate) func.apply(context, arguments);
		}
		var callNow = immediate && !timeout;
		
		clearTimeout(timeout);
		timeout = setTimeout(later, wait || 500);
		if (callNow) func.apply(context, arguments);
	};
};
