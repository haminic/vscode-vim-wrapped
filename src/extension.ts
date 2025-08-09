import * as vscode from 'vscode';

/**
 * Extension to enhance Vim extension's wrapped line cursor movements.
 * Fixes cursor column tracking with wrapped lines and avoids
 * leaving the cursor at the very end of wrapped lines.
 */
export function activate(context: vscode.ExtensionContext) {
    const mover = new WrappedLineMover();

    context.subscriptions.push(
        vscode.commands.registerCommand("vimWrapped.cursorDown", () => mover.moveCursorLineWrapped("down")),
        vscode.commands.registerCommand("vimWrapped.cursorUp", () => mover.moveCursorLineWrapped("up")),
    );

    mover.registerListeners(context);
}

export function deactivate() {}

class WrappedLineMover {
    private desiredColumn = 0;
    private isMoving = false;
    private programmaticMoveCount = 0;

    private isInProgrammaticMove() {
        return this.programmaticMoveCount > 0;
    }

    private async runProgrammaticMove(action: () => Thenable<void>) {
        this.programmaticMoveCount++;
        try {
            await action();
        } finally {
            this.programmaticMoveCount = Math.max(0, this.programmaticMoveCount - 1);
        }
    }

    private async doDefaultCursorMove(
        to: "up" | "down" | "left" | "right" | "wrappedLineStart" | "wrappedLineEnd"
    ) {
        await this.runProgrammaticMove(() =>
            vscode.commands.executeCommand("cursorMove", { to, by: "wrappedLine" })
        );
    }

    public async moveCursorLineWrapped(direction: "up" | "down") {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !isSingleSelection(editor)) { return; }

        const [wrapStart, wrapEnd] = await this.getWrappedLineBounds(editor);
        const lineNum = editor.selection.active.line;
        const line = editor.document.lineAt(lineNum).text;
        const totalLines = editor.document.lineCount;

        // Stop if at document boundary and cursor at line start/end
        if (
            (direction === "down" && wrapEnd === line.length && lineNum >= totalLines - 1) ||
            (direction === "up" && wrapStart === 0 && lineNum === 0)
        ) { return; }

        if (!this.isMoving) {
            this.isMoving = true;
            this.desiredColumn = getColumnFromCharacter(
                line, wrapStart, editor.selection.active.character
            );
        }

        await this.doDefaultCursorMove(direction);
        await this.adjustCursorToColumn(editor, this.desiredColumn);
    }

    public registerListeners(context: vscode.ExtensionContext) {
        const update = async (snapCursor: boolean) => {
            if (this.isInProgrammaticMove()) { return; }

            this.isMoving = false;
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.active.character === 0) { return; }

            if (!isInInsertMode(editor) && snapCursor) {
                await this.snapCursorInsideWrappedLine(editor);
            }
        };

        context.subscriptions.push(
            vscode.window.onDidChangeTextEditorSelection(e => update(e.kind === vscode.TextEditorSelectionChangeKind.Mouse)),
            vscode.window.onDidChangeTextEditorVisibleRanges(() => update(false)),
            vscode.window.onDidChangeActiveTextEditor(() => update(false)),
        );
    }

    private async adjustCursorToColumn(editor: vscode.TextEditor, column: number) {
        const [wrapStart, wrapEnd] = await this.getWrappedLineBounds(editor);
        const lineNum = editor.selection.active.line;
        const line = editor.document.lineAt(lineNum).text;

        const charPos = getCharacterFromColumn(line, wrapStart, wrapEnd, column);
        const newPos = new vscode.Position(lineNum, charPos);
        const newSelection = new vscode.Selection(newPos, newPos);

        await this.updateSelection(editor, newSelection);
    }

    private async getWrappedLineBounds(editor: vscode.TextEditor): Promise<[number, number]> {
        // Actually not sure why this doesn't need to be reverted back.
        // Probably from vim's code (?)
        editor.options.cursorStyle = vscode.TextEditorCursorStyle.LineThin;

        const originalSelection = editor.selection;

        await this.doDefaultCursorMove("wrappedLineStart");
        const startChar = editor.selection.active.character;

        await this.doDefaultCursorMove("wrappedLineEnd");
        const endChar = editor.selection.active.character;

        await this.updateSelection(editor, originalSelection);
        return [startChar, endChar];
    }

    private async snapCursorInsideWrappedLine(editor: vscode.TextEditor) {
        const originalSelection = editor.selection;

        await this.doDefaultCursorMove("wrappedLineEnd");
        const endSelection = editor.selection;

        if (originalSelection.isEqual(endSelection)) {
            const lineNum = endSelection.active.line;
            const line = editor.document.lineAt(lineNum).text;
            const newPos = new vscode.Position(
                lineNum, getLeftColumnCharacter(line, endSelection.active.character)
            ); 
            await this.updateSelection(editor, new vscode.Selection(newPos, newPos));
        } else {
            await this.updateSelection(editor, originalSelection);
        }
    }

    private async updateSelection(editor: vscode.TextEditor, selection: vscode.Selection) {
        await this.runProgrammaticMove(async () => {
            if (editor.selection.isEqual(selection)) { return; }

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

/** Helpers */

function isInInsertMode(editor: vscode.TextEditor): boolean {
    return editor.options.cursorStyle === vscode.TextEditorCursorStyle.Line;
}

function isSingleSelection(editor: vscode.TextEditor): boolean {
    return editor.selections.length === 1;
}

/** Thai Character Handling */

const THAI_NON_BASE_CODES = [
    '่', '้', '๊', '๋', // Tone marks
    'ิ', 'ี', 'ื', 'ั', 'ํ', '์', '็', // Ascenders
    'ุ', 'ู', // Descenders
    'ำ', // Special vowel
].map(c => c.charCodeAt(0));

function getColumnFromCharacter(line: string, wrapStart: number, character: number): number {
    let count = 0;
    for (let i = wrapStart; i <= character; i++) {
        if (!THAI_NON_BASE_CODES.includes(line.charCodeAt(i))) { count++; }
    }
    return count;
}

function getCharacterFromColumn(line: string, wrapStart: number, wrapEnd: number, column: number): number {
    let count = 0;
    let index = wrapStart;
    let lastColumnCharacter = wrapStart;
    while (index < wrapEnd && count < column) {
        if (!THAI_NON_BASE_CODES.includes(line.charCodeAt(index))) {
            lastColumnCharacter = index;
            count++;
        }
        index++;
    }
    return lastColumnCharacter;
}

function getLeftColumnCharacter(line: string, character: number) {
    let index = character - 1;
    while (index > 0) {
        if (!THAI_NON_BASE_CODES.includes(line.charCodeAt(index))) { break; }
        index--;
    }
    return index;
}