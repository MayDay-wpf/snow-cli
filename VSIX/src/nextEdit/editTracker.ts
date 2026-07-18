import * as vscode from 'vscode';
import {log} from './logger';

/** A meaningful text edit detected after the user paused typing. */
export interface RecentEdit {
	uri: vscode.Uri;
	languageId: string;
	/** Original text that was removed/replaced (may be ''). */
	oldText: string;
	/** New text inserted in its place (may be ''). */
	newText: string;
	/** Range in the post-edit document covering newText. */
	newRange: vscode.Range;
	/** Cursor position at the moment the edit settled (for proximity sort). */
	cursorOffset: number;
	timestamp: number;
}

export interface EditTrackerOptions {
	/** Quiet period before emitting the edit. */
	quietMs: number;
	/** Skip edits larger than this (likely paste / format / refactor). */
	maxEditLength: number;
	/** Skip files larger than this when capturing snapshots. */
	maxSnapshotBytes: number;
}

const SUPPORTED_SCHEMES = new Set(['file', 'untitled', 'vscode-remote']);

/**
 * Tracks the most recent user edit on the active document and emits a
 * `RecentEdit` after a short quiet period.
 *
 * Critical design: we maintain a per-document **baseline snapshot** that is
 * captured at the START of an edit burst and held constant until `flush()`.
 * Each `onChange` recomputes the cumulative diff between the baseline and the
 * current document text. This guarantees that fast continuous typing (which
 * fires many tiny single-character events) collapses into one logical edit
 * instead of overwriting the previous diff with the last keystroke.
 */
export class EditTracker implements vscode.Disposable {
	private readonly snapshots = new Map<string, string>();
	private readonly disposables: vscode.Disposable[] = [];
	private pendingTimer: NodeJS.Timeout | undefined;
	private pending:
		| {
				uri: vscode.Uri;
				languageId: string;
				/** Stable snapshot captured before the first change of this burst. */
				baseline: string;
		  }
		| undefined;
	private listeners: Array<(edit: RecentEdit) => void> = [];
	private pauseUntil = 0;

	constructor(private options: EditTrackerOptions) {
		this.disposables.push(
			vscode.workspace.onDidOpenTextDocument(doc => this.captureSnapshot(doc)),
			vscode.workspace.onDidCloseTextDocument(doc => {
				this.snapshots.delete(doc.uri.toString());
			}),
			vscode.workspace.onDidChangeTextDocument(e => this.onChange(e)),
		);
		vscode.workspace.textDocuments.forEach(d => this.captureSnapshot(d));
	}

	public onEdit(listener: (edit: RecentEdit) => void): vscode.Disposable {
		this.listeners.push(listener);
		return {
			dispose: () => {
				this.listeners = this.listeners.filter(l => l !== listener);
			},
		};
	}

	public updateOptions(options: Partial<EditTrackerOptions>): void {
		this.options = {...this.options, ...options};
	}

	/** Ignore changes for `ms` (used after we apply our own edits). */
	public pause(ms: number): void {
		this.pauseUntil = Math.max(this.pauseUntil, Date.now() + ms);
		this.cancelPending();
	}

	public dispose(): void {
		this.disposables.forEach(d => d.dispose());
		if (this.pendingTimer) clearTimeout(this.pendingTimer);
		this.snapshots.clear();
		this.listeners = [];
	}

	private captureSnapshot(doc: vscode.TextDocument): void {
		if (!SUPPORTED_SCHEMES.has(doc.uri.scheme)) return;
		const text = doc.getText();
		if (text.length > this.options.maxSnapshotBytes) {
			this.snapshots.delete(doc.uri.toString());
			return;
		}
		this.snapshots.set(doc.uri.toString(), text);
	}

	private onChange(e: vscode.TextDocumentChangeEvent): void {
		const key = e.document.uri.toString();
		if (!SUPPORTED_SCHEMES.has(e.document.uri.scheme)) return;
		if (e.contentChanges.length === 0) return;

		const oldSnapshot = this.snapshots.get(key);
		const newText = e.document.getText();
		// Always refresh the working snapshot (used as future baselines).
		this.snapshots.set(key, newText);

		if (oldSnapshot === undefined) return;
		if (Date.now() < this.pauseUntil) {
			this.cancelPending();
			return;
		}

		// Start a new burst, OR continue the existing one. The baseline stays
		// constant across the entire burst until we flush.
		if (!this.pending || this.pending.uri.toString() !== key) {
			// If we had a pending burst on a different document, drop it.
			this.pending = {
				uri: e.document.uri,
				languageId: e.document.languageId,
				baseline: oldSnapshot,
			};
		}

		// Restart the debounce timer.
		if (this.pendingTimer) clearTimeout(this.pendingTimer);
		this.pendingTimer = setTimeout(() => this.flush(), this.options.quietMs);
	}

	private cancelPending(): void {
		if (this.pendingTimer) {
			clearTimeout(this.pendingTimer);
			this.pendingTimer = undefined;
		}
		this.pending = undefined;
	}

	private flush(): void {
		const p = this.pending;
		this.pending = undefined;
		this.pendingTimer = undefined;
		if (!p) return;

		const doc = vscode.workspace.textDocuments.find(
			d => d.uri.toString() === p.uri.toString(),
		);
		if (!doc) return;
		const current = doc.getText();
		const diff = diffByEdges(p.baseline, current);
		if (!diff) return; // no change

		const {start, oldText, newText} = diff;
		// Skip trivial whitespace-only edits.
		if (!oldText.trim() && !newText.trim()) return;

		const maxLen = this.options.maxEditLength;
		if (oldText.length > maxLen || newText.length > maxLen) {
			log(
				`edit too large (old=${oldText.length}, new=${newText.length}); ignored`,
			);
			return;
		}

		const startPos = doc.positionAt(start);
		const endPos = doc.positionAt(start + newText.length);
		const activeEditor = vscode.window.activeTextEditor;
		const cursorOffset =
			activeEditor && activeEditor.document.uri.toString() === p.uri.toString()
				? doc.offsetAt(activeEditor.selection.active)
				: start + newText.length;
		const event: RecentEdit = {
			uri: p.uri,
			languageId: p.languageId,
			oldText,
			newText,
			newRange: new vscode.Range(startPos, endPos),
			cursorOffset,
			timestamp: Date.now(),
		};
		log(
			`edit flushed: old=${JSON.stringify(
				oldText.slice(0, 60),
			)} new=${JSON.stringify(newText.slice(0, 60))} range=${startPos.line}:${startPos.character}-${endPos.line}:${endPos.character}`,
		);
		for (const l of this.listeners) {
			try {
				l(event);
			} catch (err) {
				log(`listener error: ${(err as Error)?.message ?? err}`);
			}
		}
	}
}

/**
 * Minimal text diff: trim the longest common prefix and suffix, return the
 * middle slices. Works perfectly for single-region edits (the vast majority of
 * keyboard activity). For multi-region edits it falls back to the envelope
 * range — still useful for our purposes.
 */
export function diffByEdges(
	a: string,
	b: string,
): {start: number; oldText: string; newText: string} | undefined {
	if (a === b) return undefined;
	const aLen = a.length;
	const bLen = b.length;
	const maxPrefix = Math.min(aLen, bLen);

	let prefix = 0;
	while (prefix < maxPrefix && a.charCodeAt(prefix) === b.charCodeAt(prefix)) {
		prefix++;
	}
	let suffix = 0;
	const maxSuffix = Math.min(aLen - prefix, bLen - prefix);
	while (
		suffix < maxSuffix &&
		a.charCodeAt(aLen - 1 - suffix) === b.charCodeAt(bLen - 1 - suffix)
	) {
		suffix++;
	}
	const oldText = a.slice(prefix, aLen - suffix);
	const newText = b.slice(prefix, bLen - suffix);
	if (oldText === '' && newText === '') return undefined;
	return {start: prefix, oldText, newText};
}
