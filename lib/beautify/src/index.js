import posthtml from 'posthtml';
import beautify from 'posthtml-beautify';
import jsBeautify from 'js-beautify';

var formatCSS = jsBeautify.css;
var formatJS = jsBeautify.js;

export function formatHTML (html) {
	return posthtml()
		.use(beautify({
			rules: {
				indent: '\t',
				sortAttr: true,
			}
		}))
		.process(html)
		.then(result => {
			return result.html;
		});
}

window.beautifyHTML = formatHTML;
window.beautifyCSS = formatCSS;
window.beautifyJS = formatJS;
