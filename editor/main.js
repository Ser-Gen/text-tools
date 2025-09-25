// The Monaco Editor can be easily created, given an
// empty container and an options literal.
// Two members of the literal are "value" and "language".
// The editor takes the full size of its container.


// включаем редакторы
require.config({ paths: { 'vs': 'min/vs' } });
require(['vs/editor/editor.main'], onEditor);

function onEditor () {
	var originalModel = monaco.editor.createModel("heLLo world!", "text/plain");
	var modifiedModel = monaco.editor.createModel("hello orlando!", "text/plain");
	
	var diffEditor = monaco.editor.createDiffEditor(document.getElementById("container"), {
		theme: 'vs-dark',
		originalEditable: true,
		readOnly: false,
	});
	diffEditor.setModel({
		original: originalModel,
		modified: modifiedModel
	});

	setTimeout(() => {
		console.log(originalModel.getValue());
	}, 100);
}
