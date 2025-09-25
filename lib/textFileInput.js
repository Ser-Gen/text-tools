function TextFileInput (nest, cfg) {
	var self = this;
	
	this.nest = nest;
	this.cfg = cfg || {};

	if (typeof this.cfg.info === 'undefined') {
		this.cfg.info = `
			Дважды кликайте, закидывайте сюда файлы, вставляйте с помощью <kbd>Ctrl + v</kbd> картинки обычные и в виде <code>base64</code><br>или используйте [пример].
		`;
	};

	this.isGloballyInited = false;

	if (document.querySelector('#textFileInputStyles')) {
		this.isGloballyInited = true;
	}
	else {
		this.globallyInit();
	};

	this.init();
};

TextFileInput.prototype.globallyInit = function () {
	var styles = `
		<style id="textFileInputStyles">
		.UploaderDropzone {
			position: fixed;
			display: table;
			table-layout: fixed;
			width: 100vw;
			height: 100vh;
			top: 0;
			left: 0;
			visibility: hidden;
		}
		.UploaderDropzone--onDragOver {
			visibility: visible;
		}
		.UploaderDropzone__box {
			display: table-cell;
			position: relative;
		}
		.UploaderDropzone__box:before {
			content: "";
			box-sizing: border-box;
			position: absolute;
			top: 2vh;
			bottom: 2vh;
			right: 2vw;
			left: 2vw;
			border: 10px dashed #fff;
			border-radius: 10vw;
			z-index: 1;
			
			opacity: 0;
			visibility: hidden;
			transition: .2s;
		}
		.UploaderDropzone__box:after {
			content: "Drop file here!";
			position: absolute;
			top: 0;
			left: 0;
			width: 100%;
			height: 100%;
			background-color: rgba(0,0,0,.2);
			text-align: center;
			font-size: 10vh;
			line-height: 95vh;
			font-weight: bold;
			color: #fff;
			
			opacity: 0;
			visibility: hidden;
			transition: .2s;
		}
		.UploaderDropzone__box--onDragOver:before,
		.UploaderDropzone__box--onDragOver:after {
			opacity: 1;
			visibility: visible;
		}
		
		.Uploader {
			border: 1px dashed #aaa;
			box-sizing: border-box;
			height: 100%;
			text-align: center;
			position: relative;
		
			display: flex;
			align-items: center;
			justify-content: center;
		}
		.Uploader--focus {
			border-color: blue;
		}
		.Uploader__input {
			position: absolute;
			visibility: hidden;
		}

		.Uploader__area {
			position: absolute;
			top: 0;
			left: 0;
			width: 100%;
			height: 100%;
			box-sizing: border-box;
			border: 2px;
			opacity: 0;
			cursor: default;
		}
		</style>
	`;

	document.querySelector('head').insertAdjacentHTML('afterbegin', styles);
};

TextFileInput.prototype.init = function () {
	var self = this;
	
	if (typeof this.cfg.onFiles === 'undefined') {
		this.cfg.onFiles = function () {};
	};

	this.render();

	this.uploaderArea.addEventListener('focus', function () {
		self.uploader.classList.add('Uploader--focus');
	});
	this.uploaderArea.addEventListener('blur', function () {
		self.uploader.classList.remove('Uploader--focus');
	});

	// вызов поля ввода файла
	this.uploader.addEventListener('dblclick', onDblClick);

	function onDblClick (e) {
		self.uploaderInput.click();
	};

	// отключение выделения текста при выборе файла
	function onMouseDown (e) {
		e.preventDefault();
	};

	// изменение поля файла
	this.uploaderInput.addEventListener('change', onFile);

	// заброс файла
	this.dropZoneBox.addEventListener('drop', function handleDragOver(e) {
		onFile(e);
		self.dropZone.classList.remove('UploaderDropzone--onDragOver');
		self.dropZoneBox.classList.remove('UploaderDropzone__box--onDragOver');
	});

	// реакция на наведение файлом
	document.body.addEventListener('dragover', function handleDragOver(e) {
		e.stopPropagation();
		e.preventDefault();
		e.dataTransfer.dropEffect = 'copy';
		self.dropZone.classList.add('UploaderDropzone--onDragOver');
	});

	this.dropZoneBox.addEventListener('dragover', function handleDragOver(e) {
		e.stopPropagation();
		e.preventDefault();
		e.dataTransfer.dropEffect = 'copy';
		self.dropZoneBox.classList.add('UploaderDropzone__box--onDragOver');
	});

	// реакция на отведение файлом
	this.dropZoneBox.addEventListener('dragleave', function handleDragOver(e) {
		self.dropZone.classList.remove('UploaderDropzone--onDragOver');
		self.dropZoneBox.classList.remove('UploaderDropzone__box--onDragOver');
	});

	// отправка файла
	function onFile (e) {
		e.preventDefault();

		var input = e.target;
		var files = e.dataTransfer ? e.dataTransfer.files : input.files;

		if (!files) {
			return false;
		};

		self.cfg.onFiles(files);
	};
};

TextFileInput.prototype.render = function () {
	this.uploader = document.createElement('div');
	this.uploader.className = 'Uploader';

	this.uploaderInfo = document.createElement('div');
	this.uploaderInfo.className = 'Uploader__info';
	this.uploaderInfo.innerHTML = this.cfg.info;

	this.uploaderArea = document.createElement('textarea');
	this.uploaderArea.className = 'Uploader__area';
	this.uploaderArea.autofocus = true;

	this.uploaderInput = document.createElement('input');
	this.uploaderInput.className = 'Uploader__input';
	this.uploaderInput.setAttribute('type', 'file');
	this.uploaderInput.setAttribute('multiple', 'multiple');

	if (this.cfg.inputId) {
		this.uploaderInput.id = this.cfg.inputId;
	};

	this.dropZone = document.body.querySelector('.UploaderDropzone');

	if (!this.dropZone) {
		this.dropZone = document.createElement('div');
		this.dropZone.className = 'UploaderDropzone';
		document.body.appendChild(this.dropZone);
	};

	this.dropZoneBox = document.createElement('div');
	this.dropZoneBox.className = 'UploaderDropzone__box';

	this.dropZone.appendChild(this.dropZoneBox);

	this.uploader.appendChild(this.uploaderInfo);
	this.uploader.appendChild(this.uploaderArea);
	this.uploader.appendChild(this.uploaderInput);

	this.nest.appendChild(this.uploader);
};
