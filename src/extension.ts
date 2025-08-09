import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {

	context.subscriptions.push(
		vscode.commands.registerCommand("vim.lineWrappedDown", () => moveCursorLineWrapped("down")),
		vscode.commands.registerCommand("vim.lineWrappedUp", () => moveCursorLineWrapped("up"))
	);

	registerListeners(context);
}

export function deactivate() {}

/** State Management */

let desiredColumn: number = 0;
let isMoving: boolean = false;
let programmaticMoveCounter = 0;

function beginProgrammaticMove() {
	programmaticMoveCounter++;
}

function endProgrammaticMove() {
	programmaticMoveCounter = Math.max(0, programmaticMoveCounter - 1);
}

function isInProgrammaticMove() {
	return programmaticMoveCounter > 0;
}

/** Main Functions */

async function moveCursorLineWrapped(direction: "down" | "up") {
	const editor = vscode.window.activeTextEditor;
	if (!editor || !isSingleSelection(editor)) { return; }

	try {
		beginProgrammaticMove();

		const [wrapStart, wrapEnd] = await getWrappedLineBeginEnd(editor);	
		const currentLine = editor.selection.active.line;
		const totalLines = editor.document.lineCount;
		const lineLength = editor.document
			.lineAt(editor.selection.active.line)
			.text.length;
		
		if (
			(direction === "down" && wrapEnd === lineLength && currentLine >= totalLines - 1) ||
			(direction === "up" && wrapStart === 0 && currentLine === 0)
		) { return; }

		if (!isMoving) {
			isMoving = true;
			desiredColumn = editor.selection.active.character - wrapStart;
		}

		await vscode.commands.executeCommand(
			direction === "down" ? "cursorDown" : "cursorUp"
		);
		await adjustCursorToColumn(editor, desiredColumn);
	} finally {
		endProgrammaticMove();
	}
}

function registerListeners(context: vscode.ExtensionContext) {
	const update = async () => {
		if (!isInProgrammaticMove()) {
			isMoving = false;
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.selection.active.character === 0) { return; }
			if (!isInInsertMode(editor)) { await snapCursorInsideLine(editor); }
		}
	};

	context.subscriptions.push(
		vscode.window.onDidChangeTextEditorSelection(update),
		// vscode.window.onDidChangeTextEditorVisibleRanges(update),
		// vscode.window.onDidChangeActiveTextEditor(update)
	);
}

/** Helper Functions */

function isInInsertMode(editor: vscode.TextEditor): boolean {
	return editor.options.cursorStyle === vscode.TextEditorCursorStyle.Line;
}

function isSingleSelection(editor: vscode.TextEditor): boolean {
	return editor.selections.length === 1;
}

async function adjustCursorToColumn(editor: vscode.TextEditor, column: number): Promise<void> {
	try {
		beginProgrammaticMove();
		const [wrapStart, wrapEnd] = await getWrappedLineBeginEnd(editor);

		const selectionBeforeAdjustment = editor.selection;
		const newPos = new vscode.Position(
			selectionBeforeAdjustment.active.line,
			Math.min(
				wrapStart + column,
				Math.max(wrapEnd - 1, 0)
			)
		);
		const selectionAfterAdjustment = new vscode.Selection(newPos, newPos);
		await updateSelection(editor, selectionAfterAdjustment);
	} finally {
		endProgrammaticMove();
	}
}

// VS Code does not provide a straightforward way to get the wrapped line beginning/ending character. This is a hack.
async function getWrappedLineBeginEnd(editor: vscode.TextEditor): Promise<[number, number]> {
	try { 
		beginProgrammaticMove();
		const originalSelection = editor.selection;
		const beginEndPosition: [number, number] = [0, 0];

		await vscode.commands.executeCommand(
			"cursorMove",
			{ "to": "wrappedLineStart" }
		);
		beginEndPosition[0] = editor.selection.active.character;

		await vscode.commands.executeCommand(
			"cursorMove",
			{ "to": "wrappedLineEnd" }
		);
		beginEndPosition[1] = editor.selection.active.character;

		await updateSelection(editor, originalSelection);
		return beginEndPosition;
	} finally {
		endProgrammaticMove();
	}
}

// Again, we can't check for hanging cursors easily. This is also a hack.
async function snapCursorInsideLine(editor: vscode.TextEditor): Promise<void> {
	try {
		beginProgrammaticMove();
		const originalSelection = editor.selection;
		await vscode.commands.executeCommand(
			"cursorMove",
			{ "to": "wrappedLineEnd" }
		);
		const endSelection = editor.selection;

		if (originalSelection.isEqual(endSelection)) {
			// We use command here instead of directly setting the variable, so we avoid one more use of updateSelection().
			await vscode.commands.executeCommand("cursorLeft");
		} else {
			await updateSelection(editor, originalSelection);
		}
	} finally {
		endProgrammaticMove();
	}
}

// Helper async function to wait for cursor update before running the next lines. This is used in programmaticMoves so the VS Code tick does not accidentally trigger selection change again after programmaticMove is closed.
async function updateSelection(editor: vscode.TextEditor, selection: vscode.Selection): Promise<void> {
	const originalSelection = editor.selection;
	editor.selection = selection;
	if (originalSelection.isEqual(selection)) {
		await new Promise<void>(resolve => {
			const disposable = vscode.window.onDidChangeTextEditorSelection(() => {
				disposable.dispose();
				resolve();
			});
		});
	}
}
