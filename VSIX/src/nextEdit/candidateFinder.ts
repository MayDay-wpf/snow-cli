import * as vscode from 'vscode';
import * as path from 'path';
import {RecentEdit} from './editTracker';
import {NextEditConfig} from './nextEditConfig';
import {CompletionConfig} from '../completion/completionConfig';
import {
	requestNextEditCandidates,
	NextEditAiCandidate,
	DiagnosticHint,
} from './nextEditClient';
import {log} from './logger';

/**
 * AI-driven Next Edit candidates. The finder no longer performs any static
 * analysis (LSP references, text search, identifier scanning). It only:
 *   1. Collects context (recent edit + current file + a few related files)
 *   2. Asks the configured LLM to predict follow-up edits
 *   3. Locates each AI candidate inside the target document and converts it
 *      into a concrete `Candidate` (uri + range + replacement).
 */
export type CandidateMode = 'replace';

export interface Candidate {
	uri: vscode.Uri;
	range: vscode.Range;
	mode: 'replace';
	replacement: string;
	preview: string;
	source: 'ai';
	reason: string;
}

const MAX_PREVIEW = 80;
const IDENTIFIER_GLOBAL_RE = /[A-Za-z_$][\w$]*/g;
const MAX_WORKSPACE_FILES = 8;
const MAX_WORKSPACE_BYTES = 100 * 1024;
const MAX_FINDFILES = 200;
const MAX_DIAGNOSTICS_PER_FILE = 30;
const MAX_DIAGNOSTIC_MESSAGE_LEN = 200;

const STOPWORDS = new Set([
	'if',
	'else',
	'for',
	'while',
	'do',
	'switch',
	'case',
	'break',
	'continue',
	'return',
	'function',
	'const',
	'let',
	'var',
	'class',
	'extends',
	'implements',
	'interface',
	'type',
	'enum',
	'import',
	'from',
	'as',
	'export',
	'default',
	'new',
	'this',
	'super',
	'true',
	'false',
	'null',
	'undefined',
	'void',
	'async',
	'await',
	'yield',
	'try',
	'catch',
	'finally',
	'throw',
	'public',
	'private',
	'protected',
	'readonly',
	'static',
	'abstract',
	'string',
	'number',
	'boolean',
	'any',
	'unknown',
	'never',
	'object',
	'in',
	'of',
	'is',
	'or',
	'and',
	'not',
	'with',
	'def',
	'pass',
	'self',
]);

export class CandidateFinder {
	constructor(
		private getConfig: () => NextEditConfig,
		private getCompletionConfig: () => CompletionConfig,
	) {}

	public async find(
		edit: RecentEdit,
		token: vscode.CancellationToken,
	): Promise<Candidate[]> {
		const config = this.getConfig();
		const completionConfig = this.getCompletionConfig();

		// Load current file content.
		const currentDoc = await openDoc(edit.uri);
		if (!currentDoc) {
			log('candidateFinder: current document unavailable');
			return [];
		}
		if (token.isCancellationRequested) return [];

		const currentText = currentDoc.getText();
		const currentPath = displayPath(edit.uri);

		// Collect identifiers from the edit to seed workspace scanning.
		const identifiers = extractIdentifiers(edit.newText, edit.oldText);
		log(
			`candidateFinder: identifiers=${JSON.stringify(identifiers.slice(0, 8))}`,
		);

		// Gather related workspace files (only when scope=workspace).
		let workspaceFiles: Array<{
			path: string;
			content: string;
			diagnostics: DiagnosticHint[];
		}> = [];
		if (config.scope === 'workspace' && identifiers.length > 0) {
			workspaceFiles = await collectRelatedWorkspaceFiles(
				edit.uri,
				identifiers,
				token,
			);
		}
		if (token.isCancellationRequested) return [];

		// Build the AI request.
		const aiCandidates = await requestNextEditCandidates(completionConfig, {
			edit: {
				file: currentPath,
				oldText: edit.oldText,
				newText: edit.newText,
				line: edit.newRange.start.line,
			},
			currentFile: {
				path: currentPath,
				languageId: edit.languageId,
				content: currentText,
				diagnostics: collectDiagnosticsFor(edit.uri),
			},
			workspaceFiles,
			signal: tokenToAbortSignal(token),
		});

		if (token.isCancellationRequested) return [];
		log(`candidateFinder: AI returned ${aiCandidates.length} raw candidate(s)`);

		// Resolve each AI candidate into a concrete vscode location.
		const out: Candidate[] = [];
		const seen = new Set<string>();
		for (const ai of aiCandidates) {
			if (token.isCancellationRequested) break;
			const resolved = await resolveAiCandidate(ai, edit, currentDoc);
			if (!resolved) continue;
			const key = `${resolved.uri.toString()}::${resolved.range.start.line}:${
				resolved.range.start.character
			}:${resolved.range.end.line}:${resolved.range.end.character}`;
			if (seen.has(key)) continue;
			if (isInsideEditRange(resolved, edit)) continue;
			seen.add(key);
			out.push(resolved);
		}

		out.sort((a, b) => rank(a, edit) - rank(b, edit));
		log(`candidateFinder: ${out.length} resolved candidate(s)`);
		return out.slice(0, config.maxCandidates);
	}
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function displayPath(uri: vscode.Uri): string {
	const folder = vscode.workspace.getWorkspaceFolder(uri);
	if (folder) {
		const rel = path.relative(folder.uri.fsPath, uri.fsPath);
		if (rel && !rel.startsWith('..')) return rel;
	}
	return uri.fsPath;
}

function extractIdentifiers(...texts: string[]): string[] {
	const set = new Set<string>();
	for (const text of texts) {
		if (!text) continue;
		const matches = text.match(IDENTIFIER_GLOBAL_RE) ?? [];
		for (const m of matches) {
			if (m.length < 3) continue;
			if (STOPWORDS.has(m)) continue;
			set.add(m);
		}
	}
	return [...set];
}

async function collectRelatedWorkspaceFiles(
	currentUri: vscode.Uri,
	identifiers: string[],
	token: vscode.CancellationToken,
): Promise<
	Array<{path: string; content: string; diagnostics: DiagnosticHint[]}>
> {
	const include = '**/*';
	const exclude =
		'{**/node_modules/**,**/dist/**,**/out/**,**/.git/**,**/build/**,**/.next/**,**/coverage/**}';
	let uris: vscode.Uri[];
	try {
		uris = await vscode.workspace.findFiles(
			include,
			exclude,
			MAX_FINDFILES,
			token,
		);
	} catch (err) {
		log(`findFiles failed: ${(err as Error)?.message ?? err}`);
		return [];
	}
	if (token.isCancellationRequested) return [];

	const currentUriStr = currentUri.toString();
	const out: Array<{
		path: string;
		content: string;
		diagnostics: DiagnosticHint[];
	}> = [];
	let totalBytes = 0;

	for (const uri of uris) {
		if (token.isCancellationRequested) break;
		if (out.length >= MAX_WORKSPACE_FILES) break;
		if (uri.toString() === currentUriStr) continue;

		const doc = await openDoc(uri);
		if (!doc) continue;
		const text = doc.getText();
		if (!text || text.length > 200_000) continue;

		// Quick relevance check: contains at least one identifier.
		let matches = false;
		for (const id of identifiers) {
			if (text.includes(id)) {
				matches = true;
				break;
			}
		}
		if (!matches) continue;

		// Truncate to keep total size under budget.
		const remaining = MAX_WORKSPACE_BYTES - totalBytes;
		if (remaining <= 0) break;
		const content =
			text.length > remaining
				? text.slice(0, remaining) + '\n/* … truncated … */'
				: text;
		out.push({
			path: displayPath(uri),
			content,
			diagnostics: collectDiagnosticsFor(uri),
		});
		totalBytes += content.length;
	}
	log(`workspace context: ${out.length} file(s), ~${totalBytes} bytes`);
	return out;
}

function collectDiagnosticsFor(uri: vscode.Uri): DiagnosticHint[] {
	let raw: vscode.Diagnostic[];
	try {
		raw = vscode.languages.getDiagnostics(uri);
	} catch (err) {
		log(
			`getDiagnostics failed for ${uri.fsPath}: ${
				(err as Error)?.message ?? err
			}`,
		);
		return [];
	}
	if (!raw || raw.length === 0) return [];

	// Keep only Error / Warning.
	const filtered = raw.filter(
		d =>
			d.severity === vscode.DiagnosticSeverity.Error ||
			d.severity === vscode.DiagnosticSeverity.Warning,
	);
	if (filtered.length === 0) return [];

	// Sort: Error before Warning, then by line/column.
	filtered.sort((a, b) => {
		const sa = a.severity === vscode.DiagnosticSeverity.Error ? 0 : 1;
		const sb = b.severity === vscode.DiagnosticSeverity.Error ? 0 : 1;
		if (sa !== sb) return sa - sb;
		const la = a.range.start.line;
		const lb = b.range.start.line;
		if (la !== lb) return la - lb;
		return a.range.start.character - b.range.start.character;
	});

	const capped = filtered.slice(0, MAX_DIAGNOSTICS_PER_FILE);
	return capped.map(d => toDiagnosticHint(d));
}

function toDiagnosticHint(d: vscode.Diagnostic): DiagnosticHint {
	const severity: 'error' | 'warning' =
		d.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning';
	const rawMessage = d.message ?? '';
	const message =
		rawMessage.length > MAX_DIAGNOSTIC_MESSAGE_LEN
			? rawMessage.slice(0, MAX_DIAGNOSTIC_MESSAGE_LEN - 1) + '…'
			: rawMessage;
	let code = '';
	if (d.code !== undefined && d.code !== null) {
		const c = d.code as unknown;
		if (
			typeof c === 'object' &&
			c !== null &&
			'value' in (c as Record<string, unknown>)
		) {
			const v = (c as Record<string, unknown>).value;
			if (v !== undefined && v !== null) code = String(v);
		} else {
			code = String(c);
		}
	}
	const hint: DiagnosticHint = {
		line: d.range.start.line + 1,
		column: d.range.start.character + 1,
		severity,
		message,
	};
	if (d.source) hint.source = d.source;
	if (code) hint.code = code;
	return hint;
}

async function resolveAiCandidate(
	ai: NextEditAiCandidate,
	edit: RecentEdit,
	currentDoc: vscode.TextDocument,
): Promise<Candidate | undefined> {
	if (!ai.oldText) return undefined;

	const uri = resolveFileUri(ai.file, edit.uri);
	if (!uri) {
		log(`AI candidate dropped: cannot resolve file ${JSON.stringify(ai.file)}`);
		return undefined;
	}

	let doc: vscode.TextDocument | undefined;
	if (uri.toString() === currentDoc.uri.toString()) {
		doc = currentDoc;
	} else {
		doc = await openDoc(uri);
	}
	if (!doc) {
		log(`AI candidate dropped: cannot open ${uri.fsPath}`);
		return undefined;
	}

	const text = doc.getText();
	const idx = text.indexOf(ai.oldText);
	if (idx === -1) {
		log(
			`AI candidate dropped: oldText not found in ${displayPath(
				uri,
			)} :: ${JSON.stringify(ai.oldText.slice(0, 60))}`,
		);
		return undefined;
	}
	const start = doc.positionAt(idx);
	const end = doc.positionAt(idx + ai.oldText.length);
	const range = new vscode.Range(start, end);

	return {
		uri: doc.uri,
		range,
		mode: 'replace',
		replacement: ai.newText,
		preview: extractPreview(doc, range),
		source: 'ai',
		reason: ai.reason,
	};
}

function resolveFileUri(
	file: string,
	currentUri: vscode.Uri,
): vscode.Uri | undefined {
	if (!file) return undefined;
	// Absolute path
	if (path.isAbsolute(file)) {
		try {
			return vscode.Uri.file(file);
		} catch {
			return undefined;
		}
	}
	// Relative path — try each workspace folder first.
	const folders = vscode.workspace.workspaceFolders ?? [];
	for (const folder of folders) {
		try {
			const candidate = vscode.Uri.file(path.join(folder.uri.fsPath, file));
			return candidate;
		} catch {
			// keep trying
		}
	}
	// Fallback: relative to the current file's directory.
	try {
		const dir = path.dirname(currentUri.fsPath);
		return vscode.Uri.file(path.join(dir, file));
	} catch {
		return undefined;
	}
}

function isInsideEditRange(c: Candidate, edit: RecentEdit): boolean {
	if (c.uri.toString() !== edit.uri.toString()) return false;
	return rangesOverlap(c.range, edit.newRange);
}

function rangesOverlap(a: vscode.Range, b: vscode.Range): boolean {
	return !(a.end.isBefore(b.start) || b.end.isBefore(a.start));
}

function extractPreview(doc: vscode.TextDocument, range: vscode.Range): string {
	const line = doc.lineAt(range.start.line).text;
	const trimmed = line.trim();
	return trimmed.length > MAX_PREVIEW
		? trimmed.slice(0, MAX_PREVIEW - 1) + '…'
		: trimmed;
}

async function openDoc(
	uri: vscode.Uri,
): Promise<vscode.TextDocument | undefined> {
	try {
		return await vscode.workspace.openTextDocument(uri);
	} catch {
		return undefined;
	}
}

function rank(c: Candidate, edit: RecentEdit): number {
	const sameFile = c.uri.toString() === edit.uri.toString() ? 0 : 1;
	const lineDelta =
		c.uri.toString() === edit.uri.toString()
			? Math.abs(c.range.start.line - edit.newRange.start.line)
			: 100_000;
	return sameFile * 1_000_000 + lineDelta;
}

function tokenToAbortSignal(token: vscode.CancellationToken): AbortSignal {
	const controller = new AbortController();
	if (token.isCancellationRequested) {
		controller.abort();
	} else {
		token.onCancellationRequested(() => controller.abort());
	}
	return controller.signal;
}
