import * as vscode from 'vscode';
import {EditTracker, RecentEdit} from './editTracker';
import {CandidateFinder, Candidate} from './candidateFinder';
import {CandidateDecorations} from './decoration';
import {NextEditConfig, readNextEditConfig} from './nextEditConfig';
import {readCompletionConfig} from '../completion/completionConfig';
import {NextEditStatusBar} from './statusBar';
import {log} from './logger';

interface ActiveSession {
	edit: RecentEdit;
	queue: Candidate[];
	current: Candidate;
	/** URI of the editor where the user is currently typing (anchor). */
	anchorUri: vscode.Uri;
	/** Line in the anchor doc where we render the hint. */
	anchorLine: number;
}

const CONTEXT_KEY = 'snow-cli.nextEditActive';

/**
 * Top-level coordinator. Critical UX rule:
 *   - We never move focus away from the user's editor when a candidate is
 *     proposed; we just paint a small inline hint at the END of the current
 *     line. Only when the user presses Tab do we open the candidate file
 *     and either apply the edit or move the cursor there.
 */
export class NextEditEngine implements vscode.Disposable {
	private readonly tracker: EditTracker;
	private readonly finder: CandidateFinder;
	private readonly deco = new CandidateDecorations();
	private readonly disposables: vscode.Disposable[] = [];
	private config: NextEditConfig;
	private session: ActiveSession | undefined;
	private scanCts: vscode.CancellationTokenSource | undefined;
	private suspending = false;

	constructor(private readonly statusBar: NextEditStatusBar) {
		this.config = readNextEditConfig();
		this.tracker = new EditTracker({
			quietMs: this.config.debounceMs,
			maxEditLength: 200,
			maxSnapshotBytes: 2_000_000,
		});
		this.finder = new CandidateFinder(
			() => this.config,
			() => readCompletionConfig(),
		);

		this.disposables.push(
			this.tracker.onEdit(edit => this.onEdit(edit)),
			vscode.window.onDidChangeActiveTextEditor(editor => {
				if (!this.session) return;
				// While we are in the middle of accepting a candidate (Tab) we may
				// open / focus a different editor on purpose. Don't dismiss in that
				// window — the accept() flow will manage the session itself.
				if (this.suspending) return;
				// If user switched to a different document, dismiss the session.
				if (
					!editor ||
					editor.document.uri.toString() !== this.session.anchorUri.toString()
				) {
					this.dismiss('active editor changed');
					return;
				}
				this.redraw();
			}),
			vscode.window.onDidChangeTextEditorSelection(e => {
				if (!this.session || this.suspending) return;
				const editor = e.textEditor;
				if (
					editor.document.uri.toString() !== this.session.anchorUri.toString()
				) {
					return;
				}
				// Only react to user-driven cursor moves (not our own setSelection).
				const kind = e.kind;
				if (
					kind !== vscode.TextEditorSelectionChangeKind.Keyboard &&
					kind !== vscode.TextEditorSelectionChangeKind.Mouse
				) {
					return;
				}
				const newLine = editor.selection.active.line;
				// If user stays roughly near the edit, just move the hint along.
				if (Math.abs(newLine - this.session.anchorLine) <= 1) {
					this.session.anchorLine = newLine;
					this.redraw();
					return;
				}
				// Otherwise the user moved away on purpose — withdraw the hint.
				this.dismiss('cursor moved off anchor');
			}),
			vscode.workspace.onDidChangeTextDocument(e => {
				if (!this.session || this.suspending) return;
				// Significant text change in the anchor doc — re-evaluate next time.
				if (e.document.uri.toString() !== this.session.anchorUri.toString()) {
					return;
				}
				// Keep the hint while the edit tracker continues a burst; the
				// next flush will replace the session if anything new is found.
				// We just refresh the rendered line in case the cursor moved.
				const editor = vscode.window.activeTextEditor;
				if (
					editor &&
					editor.document.uri.toString() === this.session.anchorUri.toString()
				) {
					this.session.anchorLine = editor.selection.active.line;
					this.redraw();
				}
			}),
		);

		void vscode.commands.executeCommand('setContext', CONTEXT_KEY, false);
	}

	public updateConfig(config: NextEditConfig): void {
		const prevEnabled = this.config.enabled;
		this.config = config;
		this.tracker.updateOptions({quietMs: config.debounceMs});
		if (prevEnabled && !config.enabled) {
			this.dismiss('disabled');
		}
	}

	public dispose(): void {
		this.dismiss('engine disposed');
		this.scanCts?.cancel();
		this.scanCts?.dispose();
		this.tracker.dispose();
		this.deco.dispose();
		this.disposables.forEach(d => d.dispose());
		void vscode.commands.executeCommand('setContext', CONTEXT_KEY, false);
	}

	/** Manually trigger a scan from current cursor (no recent edit). */
	public async triggerManual(): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) return;
		const sel = editor.selection;
		const word = editor.document.getText(
			sel.isEmpty ? wordAtPosition(editor.document, sel.active) : sel,
		);
		if (!word || !word.trim()) {
			vscode.window.showInformationMessage(
				'Snow Next Edit: place the cursor on a word or select text, then trigger again.',
			);
			return;
		}
		const range = sel.isEmpty
			? wordAtPosition(editor.document, sel.active)
			: new vscode.Range(sel.start, sel.end);
		const fakeEdit: RecentEdit = {
			uri: editor.document.uri,
			languageId: editor.document.languageId,
			oldText: word,
			newText: word,
			newRange: range,
			cursorOffset: editor.document.offsetAt(sel.active),
			timestamp: Date.now(),
		};
		await this.onEdit(fakeEdit, /*manual*/ true);
	}

	public hasActiveSession(): boolean {
		return !!this.session;
	}

	/** Snapshot used by the HoverProvider to decide whether to show our card. */
	public getActiveHoverSnapshot():
		| {
				anchorUri: vscode.Uri;
				anchorLine: number;
				current: Candidate;
				remaining: number;
		  }
		| undefined {
		const s = this.session;
		if (!s) return undefined;
		return {
			anchorUri: s.anchorUri,
			anchorLine: s.anchorLine,
			current: s.current,
			remaining: s.queue.length,
		};
	}

	/** Tab: jump to the candidate (and apply if it's a replace candidate). */
	public async accept(): Promise<void> {
		const s = this.session;
		if (!s) return;
		const target = s.current;
		log(
			`accept[${target.mode}]: ${target.uri.fsPath} @ ${target.range.start.line}:${target.range.start.character}`,
		);
		this.suspending = true;
		this.tracker.pause(800);
		let landedEditor: vscode.TextEditor | undefined;
		let landedLine = s.anchorLine;
		try {
			// Open the candidate doc (preserves the anchor editor visually if
			// possible) and place the cursor at the start of the candidate.
			const doc = await vscode.workspace.openTextDocument(target.uri);
			const editor = await vscode.window.showTextDocument(doc, {
				preview: false,
				preserveFocus: false,
			});
			landedEditor = editor;
			const we = new vscode.WorkspaceEdit();
			we.replace(target.uri, target.range, target.replacement);
			const ok = await vscode.workspace.applyEdit(we);
			if (!ok) {
				this.statusBar.setMessage('failed to apply edit');
				this.dismiss('apply failed');
				return;
			}
			// Position cursor at the end of the replacement.
			const endOffset =
				doc.offsetAt(target.range.start) + target.replacement.length;
			const endPos = doc.positionAt(endOffset);
			editor.selection = new vscode.Selection(endPos, endPos);
			editor.revealRange(
				new vscode.Range(endPos, endPos),
				vscode.TextEditorRevealType.InCenterIfOutsideViewport,
			);
			landedLine = endPos.line;
		} finally {
			this.suspending = false;
		}

		// Chained Tab support: if the queue still has more candidates, keep
		// the session alive and re-anchor it at the freshly-landed position so
		// the next Tab continues hopping. There is no upper limit — the user
		// can keep pressing Tab as long as the queue has predictions.
		const stillActive = this.session === s;
		if (stillActive && s.queue.length > 0 && landedEditor) {
			s.anchorUri = landedEditor.document.uri;
			s.anchorLine = landedLine;
			const nextCandidate = s.queue.shift()!;
			s.current = nextCandidate;
			this.redraw();
			this.statusBar.setStatus('active', s.queue.length + 1);
			log(`accept: chained, ${s.queue.length} remaining`);
			return;
		}

		// Otherwise: queue exhausted — end the session. With AI-driven
		// candidates we don't speculatively rescan; the next real edit (or
		// manual trigger) will start a fresh session.
		this.dismiss('queue exhausted');
	}

	/** Alt+]: skip current and move to the next candidate. */
	public async next(): Promise<void> {
		if (!this.session) return;
		log('skip current candidate, advance');
		await this.advance();
	}

	/** Esc: dismiss. Also cancels any in-flight scan even before a session is established. */
	public dismiss(reason = 'user'): void {
		const hadScan = !!this.scanCts;
		if (!this.session) {
			// No active candidate session, but a scan may still be in-flight
			// (e.g. the user pressed Esc, or Next Edit was just disabled, while
			// the AI request is mid-flight). Cancel the scan and clear the
			// status bar's spinner so the loading state doesn't get stuck.
			if (hadScan) {
				log(`scan cancelled (no session): ${reason}`);
				this.scanCts?.cancel();
				this.scanCts?.dispose();
				this.scanCts = undefined;
				this.statusBar.setStatus('idle');
			}
			return;
		}
		log(`session dismissed: ${reason}`);
		this.scanCts?.cancel();
		this.scanCts?.dispose();
		this.scanCts = undefined;
		this.session = undefined;
		this.deco.clear();
		this.statusBar.setStatus('idle');
		void vscode.commands.executeCommand('setContext', CONTEXT_KEY, false);
	}

	private async onEdit(edit: RecentEdit, manual = false): Promise<void> {
		if (!this.config.enabled && !manual) return;
		this.scanCts?.cancel();
		this.scanCts?.dispose();
		const cts = new vscode.CancellationTokenSource();
		this.scanCts = cts;
		const token = cts.token;

		this.statusBar.setStatus('scanning');
		let candidates: Candidate[];
		try {
			candidates = await this.finder.find(edit, token);
		} catch (err) {
			log(`scan error: ${(err as Error)?.message ?? err}`);
			// Only touch the status bar if our scan is still the active one.
			// A newer onEdit may have already replaced us and set its own state.
			if (this.scanCts === cts) {
				this.scanCts = undefined;
				this.statusBar.setMessage('scan failed');
				this.statusBar.setStatus('idle');
			}
			return;
		}
		if (token.isCancellationRequested) {
			// We got cancelled (new edit, dismiss, or dispose). If a newer scan
			// has already taken over (this.scanCts !== cts), leave the status
			// alone — the newer scan owns it. Otherwise restore idle so the
			// spinner doesn't stay forever after a silent abort.
			if (this.scanCts === cts) {
				this.scanCts = undefined;
				this.statusBar.setStatus('idle');
			}
			return;
		}
		// Scan finished naturally; release ownership of the cts.
		if (this.scanCts === cts) {
			this.scanCts = undefined;
		}

		if (candidates.length === 0) {
			log('no candidates');
			if (this.session) this.dismiss('no more candidates');
			else this.statusBar.setStatus('idle');
			return;
		}

		const anchorEditor = findEditorForUri(edit.uri);
		const anchorLine = anchorEditor
			? anchorEditor.selection.active.line
			: edit.newRange.start.line;
		this.session = {
			edit,
			queue: candidates.slice(1),
			current: candidates[0],
			anchorUri: edit.uri,
			anchorLine,
		};
		this.redraw();
		this.statusBar.setStatus('active', candidates.length);
		void vscode.commands.executeCommand('setContext', CONTEXT_KEY, true);
	}

	private async advance(): Promise<void> {
		const s = this.session;
		if (!s) return;
		const next = s.queue.shift();
		if (!next) {
			log('queue empty, end session');
			this.dismiss('queue empty');
			return;
		}
		s.current = next;
		this.redraw();
		this.statusBar.setStatus('active', s.queue.length + 1);
	}

	private redraw(): void {
		const s = this.session;
		if (!s) return;
		const editor = findEditorForUri(s.anchorUri);
		if (!editor) {
			this.deco.clear();
			return;
		}
		this.deco.show(editor, s.anchorLine, s.current, s.queue.length);
	}
}

function findEditorForUri(uri: vscode.Uri): vscode.TextEditor | undefined {
	const target = uri.toString();
	const active = vscode.window.activeTextEditor;
	if (active && active.document.uri.toString() === target) return active;
	return vscode.window.visibleTextEditors.find(
		ed => ed.document.uri.toString() === target,
	);
}

function wordAtPosition(
	doc: vscode.TextDocument,
	pos: vscode.Position,
): vscode.Range {
	const range = doc.getWordRangeAtPosition(pos);
	return range ?? new vscode.Range(pos, pos);
}
