import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	const mover = new WrappedLineMover();

	context.subscriptions.push(
		vscode.commands.registerCommand("vimWrapped.cursorDown", async () => {
			await mover.moveCursorLineWrapped("down");
		}),
		vscode.commands.registerCommand("vimWrapped.cursorUp", async () => {
			await mover.moveCursorLineWrapped("up");
		}),
		// Support for my vim-qol fork.
		vscode.commands.registerCommand("vimWrapped.safeType", async (args) => {
			await mover.doSafeMove(async () => {
				await vscode.commands.executeCommand("vim.type", args);
			});
		})
	);

	mover.registerListeners(context);
}

export function deactivate() {}

class WrappedLineMover {
	private desiredColumn: number = 0;
	private isMoving: boolean = false;
	private programmaticMoveCounter: number = 0;
	private safeMoveCounter: number = 0;

	private isInProgrammaticMove(): boolean {
		return this.programmaticMoveCounter > 0;
	}

	private isInSafeMove(): boolean {
		return this.safeMoveCounter > 0;
	}

	private async doProgrammaticMove(action: () => Promise<void>) {
		try {
			this.programmaticMoveCounter++;
			await action();
		} finally {
			this.programmaticMoveCounter = Math.max(0, this.programmaticMoveCounter - 1);
		}
	}

	public async doSafeMove(action: () => Promise<void>) {
		try {
			this.programmaticMoveCounter++;
			await action();
		} finally {
			this.programmaticMoveCounter = Math.max(0, this.programmaticMoveCounter - 1);
		}
	}


	private async doDefaultCursorMove(to: string) {
		await this.doProgrammaticMove(async () => {
			await vscode.commands.executeCommand(
				"cursorMove",
				{ "to": to, "by": "wrappedLine" }
			);
		});
	}

	public async moveCursorLineWrapped(direction: "down" | "up") {
		const editor = vscode.window.activeTextEditor;
		if (!editor || !isSingleSelection(editor)) { return; }

		const [wrapStart, wrapEnd] = await this.getWrappedLineBeginEnd(editor);	
		const currentLine = editor.selection.active.line;
		const totalLines = editor.document.lineCount;
		const lineLength = editor.document
			.lineAt(editor.selection.active.line)
			.text.length;
		
		if (
			(direction === "down" && wrapEnd === lineLength && currentLine >= totalLines - 1) ||
			(direction === "up" && wrapStart === 0 && currentLine === 0)
		) { return; }

		if (!this.isMoving) {
			this.isMoving = true;
			this.desiredColumn = editor.selection.active.character - wrapStart;
		}

		await this.doDefaultCursorMove(direction);
		await this.adjustCursorToColumn(editor, this.desiredColumn);
	}

	public registerListeners(context: vscode.ExtensionContext) {
		const update = async () => {
			if (!this.isInProgrammaticMove()) {
				this.isMoving = false;
				if (this.isInSafeMove()) { return; }
				const editor = vscode.window.activeTextEditor;
				if (!editor || editor.selection.active.character === 0) { return; }
				if (!isInInsertMode(editor)) { await this.snapCursorInsideLine(editor); }
			}
		};

		context.subscriptions.push(
			vscode.window.onDidChangeTextEditorSelection(update),
			// vscode.window.onDidChangeTextEditorVisibleRanges(update),
			// vscode.window.onDidChangeActiveTextEditor(update)
		);
	}

	private async adjustCursorToColumn(editor: vscode.TextEditor, column: number): Promise<void> {
		const [wrapStart, wrapEnd] = await this.getWrappedLineBeginEnd(editor);

		const selectionBeforeAdjustment = editor.selection;
		const newPos = new vscode.Position(
			selectionBeforeAdjustment.active.line,
			Math.min(
				wrapStart + column,
				Math.max(wrapEnd - 1, 0)
			)
		);
		const selectionAfterAdjustment = new vscode.Selection(newPos, newPos);
		await this.updateSelection(editor, selectionAfterAdjustment);
	}

	// VS Code does not provide a straightforward way to get the wrapped line beginning/ending character. This is a hack.
	private async getWrappedLineBeginEnd(editor: vscode.TextEditor): Promise<[number, number]> {
		const originalSelection = editor.selection;
		const beginEndPosition: [number, number] = [0, 0];

		await this.doDefaultCursorMove("wrappedLineStart");
		beginEndPosition[0] = editor.selection.active.character;

		await this.doDefaultCursorMove("wrappedLineEnd");
		beginEndPosition[1] = editor.selection.active.character;

		await this.updateSelection(editor, originalSelection);
		return beginEndPosition;
	}

	// Again, we can't check for hanging cursors easily. This is also a hack.
	private async snapCursorInsideLine(editor: vscode.TextEditor): Promise<void> {
		const originalSelection = editor.selection;
		await this.doDefaultCursorMove("wrappedLineEnd");
		const endSelection = editor.selection;

		if (originalSelection.isEqual(endSelection)) {
			await this.doDefaultCursorMove("left");
		} else {
			await this.updateSelection(editor, originalSelection);
		}
	}

	private async updateSelection(editor: vscode.TextEditor, selection: vscode.Selection): Promise<void> {
		await this.doProgrammaticMove(async () => {
			const originalSelection = editor.selection;
			if (originalSelection.isEqual(selection)) { return; }

			editor.selection = selection;
			await new Promise<void>(resolve => {
				const disposable = vscode.window.onDidChangeTextEditorSelection(() => {
					disposable.dispose();
					resolve();
				});
			});
		});
	}
}

/** Helper Functions */

function isInInsertMode(editor: vscode.TextEditor): boolean {
	return editor.options.cursorStyle === vscode.TextEditorCursorStyle.Line;
}

function isSingleSelection(editor: vscode.TextEditor): boolean {
	return editor.selections.length === 1;
}
