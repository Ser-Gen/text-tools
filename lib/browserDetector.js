var isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
var SAFAR_ERROR = `У вас браузер Сафар, с ним слишком много проблем.
В нём данный инструмент нормально работать не будет.`;

if (isSafari) {
	alert(SAFAR_ERROR);
	document.body.insertAdjacentHTML('afterbegin', `<h1 style="padding: 1em; font-family: system-ui; white-space: pre-wrap; background: #ccc; margin: 0; position: fixed; top: 0; left: 0; z-index:100;" onclick="this.remove()">${SAFAR_ERROR}</h1>`);
}
