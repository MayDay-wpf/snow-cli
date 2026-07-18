import * as vscode from 'vscode';
import * as path from 'path';
import {Candidate} from './candidateFinder';

/**
 * UI for the Next Edit hint. Two layers:
 *
 *   1. AnchorHint — rendered at the END of the user's current line as a
 *      pill-shaped badge ("[›] Snow Next: Tab to jump → file.ts:42"). This
 *      sits *near the cursor*, so the user notices the suggestion without
 *      losing context.
 *
 *   2. TargetMarker — rendered on the candidate line (in whichever editor
 *      currently shows that file). It draws a left-side line highlight and a
 *      gutter icon ("▶") so when the user does Tab, they can already see
 *      where they will land. This is a peek-ahead, not a focus change.
 *
 * Both layers are pure decorations — they do not move focus or selection.
 */
/**
 * Shared anchor-hint decoration type. We deliberately create this *once*,
 * very early during extension activation (see `registerNextEdit`), so that
 * its internal decoration order ID is smaller than other after-line decorators
 * (e.g. the bundled gitBlameProvider's inline annotation). VS Code renders
 * multiple end-of-line `after` decorations in the order their types were
 * created — earlier types sit closer to the code. By owning this slot first
 * we make the Snow Next pill always appear *before* (left of) the git blame
 * annotation on the same line.
 */
let sharedAnchorHintType: vscode.TextEditorDecorationType | undefined;

export function createAnchorHintType(): vscode.TextEditorDecorationType {
	if (sharedAnchorHintType) return sharedAnchorHintType;
	sharedAnchorHintType = vscode.window.createTextEditorDecorationType({
		isWholeLine: false,
	});
	return sharedAnchorHintType;
}

export function disposeAnchorHintType(): void {
	sharedAnchorHintType?.dispose();
	sharedAnchorHintType = undefined;
}

export class CandidateDecorations implements vscode.Disposable {
	private readonly anchorHint: vscode.TextEditorDecorationType;
	private readonly targetLine: vscode.TextEditorDecorationType;
	private readonly targetRange: vscode.TextEditorDecorationType;
	private readonly editorsTouched = new Set<vscode.TextEditor>();

	constructor() {
		// Reuse the shared, pre-created anchorHint type so we keep our render
		// slot ahead of git-blame style annotations.
		this.anchorHint = createAnchorHintType();

		// Whole-line highlight + gutter marker on the candidate's line.
		this.targetLine = vscode.window.createTextEditorDecorationType({
			isWholeLine: true,
			backgroundColor: new vscode.ThemeColor('editor.linkedEditingBackground'),
			overviewRulerColor: new vscode.ThemeColor('editorInfo.foreground'),
			overviewRulerLane: vscode.OverviewRulerLane.Right,
		});

		// Tight box around the candidate range itself.
		this.targetRange = vscode.window.createTextEditorDecorationType({
			border: '1px solid',
			borderColor: new vscode.ThemeColor('editorInfo.foreground'),
			borderRadius: '3px',
			backgroundColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
			overviewRulerColor: new vscode.ThemeColor('editorInfo.foreground'),
			overviewRulerLane: vscode.OverviewRulerLane.Center,
		});
	}

	public show(
		anchorEditor: vscode.TextEditor,
		anchorLine: number,
		current: Candidate,
		remaining: number,
	): void {
		this.clear();
		this.editorsTouched.add(anchorEditor);
		const doc = anchorEditor.document;
		const safeLine = Math.min(Math.max(anchorLine, 0), doc.lineCount - 1);
		const lineEnd = doc.lineAt(safeLine).range.end;
		const hover = buildHoverMessage(current, remaining);
		const hint = buildHintText(current, remaining, doc);

		anchorEditor.setDecorations(this.anchorHint, [
			{
				range: new vscode.Range(lineEnd, lineEnd),
				hoverMessage: hover,
				renderOptions: {
					after: {
						margin: '0 0 0 1ch',
						contentText: hint,
						color: new vscode.ThemeColor('statusBarItem.prominentForeground'),
						backgroundColor: new vscode.ThemeColor(
							'statusBarItem.prominentBackground',
						),
						border: '1px solid',
						borderColor: new vscode.ThemeColor('focusBorder'),
						// VS Code does not parse multiple CSS properties here, but
						// inline padding via `width: auto` is unsupported. The
						// background + border + bright color combo is enough to
						// look like a pill / badge.
						fontWeight: 'bold',
						fontStyle: 'normal',
					},
				},
			},
		]);

		// Find any visible editor showing the target document and draw the
		// peek-ahead marker there. If none is visible, the user only sees the
		// anchor hint — they can still Tab to jump.
		const targetEditor = findVisibleEditorForUri(current.uri);
		if (targetEditor) {
			this.editorsTouched.add(targetEditor);
			const lineRange = targetEditor.document.lineAt(
				current.range.start.line,
			).range;
			targetEditor.setDecorations(this.targetLine, [
				{
					range: lineRange,
					hoverMessage: hover,
					renderOptions: {
						before: {
							margin: '0 1ch 0 0',
							contentText: '▶',
							color: new vscode.ThemeColor('editorInfo.foreground'),
							fontWeight: 'bold',
						},
					},
				},
			]);
			targetEditor.setDecorations(this.targetRange, [
				{range: current.range, hoverMessage: hover},
			]);
		}
	}

	public clear(): void {
		for (const ed of this.editorsTouched) {
			try {
				ed.setDecorations(this.anchorHint, []);
				ed.setDecorations(this.targetLine, []);
				ed.setDecorations(this.targetRange, []);
			} catch {
				// editor disposed
			}
		}
		this.editorsTouched.clear();
	}

	public dispose(): void {
		this.clear();
		// Note: anchorHint is intentionally NOT disposed here — it is a shared
		// module-level type owned by the extension lifetime (see
		// disposeAnchorHintType, called from disposeNextEdit).
		this.targetLine.dispose();
		this.targetRange.dispose();
	}
}

function buildHintText(
	current: Candidate,
	remaining: number,
	currentDoc: vscode.TextDocument,
): string {
	const total = remaining + 1;
	const sameFile = current.uri.toString() === currentDoc.uri.toString();
	const loc = sameFile
		? `L${current.range.start.line + 1}`
		: `${path.basename(current.uri.fsPath)}:${current.range.start.line + 1}`;
	const countTag = total > 1 ? ` (1/${total})` : '';
	const repl = truncate(current.replacement, 24);
	return ` ❄ Snow Next  Tab apply '${repl}' @ ${loc}${countTag}  ·  Esc dismiss `;
}

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return s.slice(0, max - 1) + '…';
}

export function buildHoverMessage(
	current: Candidate,
	remaining: number,
): vscode.MarkdownString {
	const md = new vscode.MarkdownString();
	md.isTrusted = true;
	md.supportThemeIcons = true;
	md.appendMarkdown(
		`### $(sparkle) Snow Next Edit\n\n_${current.mode} · ${current.source}_\n\n`,
	);
	const loc = `${path.basename(current.uri.fsPath)}:${
		current.range.start.line + 1
	}`;
	md.appendMarkdown(`**Target:** \`${loc}\`\n\n`);
	md.appendMarkdown(`**Preview:** \`${escapeMd(current.preview)}\`\n\n`);
	md.appendMarkdown(
		`**Replace with:** \`${escapeMd(current.replacement)}\`\n\n`,
	);
	if (current.reason && current.reason.trim()) {
		md.appendMarkdown(`**Why:** ${escapeMd(current.reason.trim())}\n\n`);
	}
	md.appendMarkdown(
		`---\n\n- $(check) **Tab** apply & jump\n- $(arrow-right) **Alt+]** skip\n- $(close) **Esc** dismiss\n`,
	);
	if (remaining > 0) {
		md.appendMarkdown(`\n_${remaining} more candidate(s) in queue_`);
	}
	return md;
}

function escapeMd(s: string): string {
	return s.replace(/`/g, '\\`');
}

function findVisibleEditorForUri(
	uri: vscode.Uri,
): vscode.TextEditor | undefined {
	const target = uri.toString();
	return vscode.window.visibleTextEditors.find(
		ed => ed.document.uri.toString() === target,
	);
}
