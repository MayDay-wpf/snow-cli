import * as vscode from 'vscode';
import {execFile, type ChildProcess} from 'child_process';
import * as path from 'path';

interface CommitMeta {
	author: string;
	authorMail: string;
	authorTime: number;
	summary: string;
}

interface LineBlame {
	commit: CommitMeta;
	hash: string;
}

interface BlameCache {
	version: number;
	lines: (LineBlame | undefined)[];
}

const UNCOMMITTED_HASH = '0000000000000000000000000000000000000000';
const HASH_LINE_RE = /^([0-9a-f]{40}) (\d+) (\d+)/;
const MAX_CACHE_FILES = 10;
const MAX_BUFFER = 10 * 1024 * 1024;

const OPEN_TIMELINE_COMMAND = 'snow-cli.openGitBlameTimeline';
const TIMELINE_VIEW_ID = 'snowCliGitBlameTimeline';

let currentLineDecorationType: vscode.TextEditorDecorationType;
let fileAnnotationDecorationType: vscode.TextEditorDecorationType;
const blameCacheMap = new Map<string, BlameCache>();
let fileAnnotationsActive = false;
let enabled = false;
let pendingBlameProcess: ChildProcess | undefined;
let updateSeq = 0;
let timelineProvider: GitBlameTimelineProvider | undefined;

function createDecorationTypes(): void {
	currentLineDecorationType = vscode.window.createTextEditorDecorationType({
		after: {
			margin: '0 0 0 3em',
			color: new vscode.ThemeColor('editorCodeLens.foreground'),
			fontStyle: 'italic',
		},
		isWholeLine: true,
	});

	fileAnnotationDecorationType = vscode.window.createTextEditorDecorationType({
		before: {
			color: new vscode.ThemeColor('editorLineNumber.foreground'),
			margin: '0 1.5em 0 0',
		},
	});
}

function formatRelativeTime(timestamp: number): string {
	const diff = Math.floor(Date.now() / 1000) - timestamp;
	if (diff < 60) {
		return 'just now';
	}
	if (diff < 3600) {
		return `${Math.floor(diff / 60)} mins ago`;
	}
	if (diff < 86400) {
		return `${Math.floor(diff / 3600)} hours ago`;
	}
	if (diff < 2592000) {
		return `${Math.floor(diff / 86400)} days ago`;
	}
	if (diff < 31536000) {
		return `${Math.floor(diff / 2592000)} months ago`;
	}
	return `${Math.floor(diff / 31536000)} years ago`;
}

function formatBlameAnnotation(blame: LineBlame): string {
	if (blame.hash === UNCOMMITTED_HASH) {
		return '    You, Uncommitted changes';
	}
	const {author, authorTime, summary} = blame.commit;
	return `    ${author}, ${formatRelativeTime(
		authorTime,
	)} • ${blame.hash.substring(0, 7)} — ${summary}`;
}

function formatFileAnnotation(blame: LineBlame, maxAuthorLen: number): string {
	if (blame.hash === UNCOMMITTED_HASH) {
		return 'You'.padEnd(maxAuthorLen) + '  Uncommitted';
	}
	return `${blame.commit.author.padEnd(maxAuthorLen)}  ${formatRelativeTime(
		blame.commit.authorTime,
	)}`;
}

function getRepoRoot(filePath: string): string | undefined {
	const fileUri = vscode.Uri.file(filePath);
	const folder = vscode.workspace.getWorkspaceFolder(fileUri);
	return (
		folder?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
	);
}

function cancelPendingBlame(): void {
	if (pendingBlameProcess) {
		try {
			pendingBlameProcess.kill();
		} catch {
			/* already exited */
		}
		pendingBlameProcess = undefined;
	}
}

function runGitBlame(filePath: string): Promise<(LineBlame | undefined)[]> {
	cancelPendingBlame();

	return new Promise((resolve, reject) => {
		const repoRoot = getRepoRoot(filePath);
		if (!repoRoot) {
			reject(new Error('No workspace folder'));
			return;
		}

		const proc = execFile(
			'git',
			['blame', '--porcelain', '--', path.relative(repoRoot, filePath)],
			{cwd: repoRoot, maxBuffer: MAX_BUFFER},
			(error, stdout) => {
				pendingBlameProcess = undefined;
				if (error) {
					reject(error);
					return;
				}
				resolve(parsePorcelainBlame(stdout));
			},
		);
		pendingBlameProcess = proc;
	});
}

function parsePorcelainBlame(output: string): (LineBlame | undefined)[] {
	const lines = output.split('\n');
	const result: (LineBlame | undefined)[] = [];
	const commitMap = new Map<string, CommitMeta>();
	let currentHash = '';
	let lineNumber = 0;
	let pendingMeta: CommitMeta | undefined;

	for (let i = 0, len = lines.length; i < len; i++) {
		const line = lines[i];
		const hashMatch = HASH_LINE_RE.exec(line);

		if (hashMatch) {
			currentHash = hashMatch[1];
			lineNumber = parseInt(hashMatch[3], 10) - 1;
			pendingMeta = commitMap.get(currentHash);
			if (!pendingMeta) {
				pendingMeta = {author: '', authorMail: '', authorTime: 0, summary: ''};
				commitMap.set(currentHash, pendingMeta);
			}
		} else if (pendingMeta) {
			if (line.charCodeAt(0) === 9) {
				// '\t'
				while (result.length <= lineNumber) {
					result.push(undefined);
				}
				result[lineNumber] = {commit: pendingMeta, hash: currentHash};
			} else if (line.startsWith('author ')) {
				pendingMeta.author = line.substring(7);
			} else if (line.startsWith('author-mail ')) {
				pendingMeta.authorMail = line.substring(12);
			} else if (line.startsWith('author-time ')) {
				pendingMeta.authorTime = parseInt(line.substring(12), 10);
			} else if (line.startsWith('summary ')) {
				pendingMeta.summary = line.substring(8);
			}
		}
	}

	return result;
}

function evictOldestCache(): void {
	if (blameCacheMap.size <= MAX_CACHE_FILES) {
		return;
	}
	const firstKey = blameCacheMap.keys().next().value;
	if (firstKey !== undefined) {
		blameCacheMap.delete(firstKey);
	}
}

async function getBlameData(
	document: vscode.TextDocument,
): Promise<(LineBlame | undefined)[]> {
	if (document.uri.scheme !== 'file') {
		return [];
	}

	const fsPath = document.uri.fsPath;
	const cached = blameCacheMap.get(fsPath);
	if (cached && cached.version === document.version) {
		return cached.lines;
	}

	try {
		const blameLines = await runGitBlame(fsPath);
		blameCacheMap.delete(fsPath);
		blameCacheMap.set(fsPath, {version: document.version, lines: blameLines});
		evictOldestCache();
		return blameLines;
	} catch {
		return [];
	}
}

function formatAbsoluteDate(timestamp: number): string {
	return new Date(timestamp * 1000).toLocaleString();
}

function formatTimelineLabel(blame: LineBlame): string {
	if (blame.hash === UNCOMMITTED_HASH) {
		return 'Uncommitted changes';
	}
	return `${formatAbsoluteDate(blame.commit.authorTime)}  ${
		blame.commit.author
	}`;
}

function createTimelineCommandArgs(
	document: vscode.TextDocument,
	line: number,
): readonly [string, number] {
	return [document.uri.toString(), line];
}

function createTimelineCommandUri(
	document: vscode.TextDocument,
	line: number,
): vscode.Uri {
	return vscode.Uri.parse(
		`command:${OPEN_TIMELINE_COMMAND}?${encodeURIComponent(
			JSON.stringify(createTimelineCommandArgs(document, line)),
		)}`,
	);
}

function createGitLineHover(
	document: vscode.TextDocument,
	line: number,
	blame: LineBlame,
): vscode.MarkdownString {
	const md = new vscode.MarkdownString(undefined, true);
	md.isTrusted = true;

	if (blame.hash === UNCOMMITTED_HASH) {
		md.appendMarkdown('**Uncommitted changes**\n\n');
		md.appendMarkdown(
			`[Open file timeline](${createTimelineCommandUri(document, line)})`,
		);
		return md;
	}

	md.appendMarkdown(
		`**${blame.commit.summary || blame.hash.substring(0, 7)}**\n\n`,
	);
	md.appendMarkdown(`Author: ${blame.commit.author}\n\n`);
	md.appendMarkdown(`Time: ${formatAbsoluteDate(blame.commit.authorTime)}\n\n`);
	md.appendMarkdown(`Commit: \`${blame.hash}\`\n\n`);
	md.appendMarkdown(
		`[Open file timeline](${createTimelineCommandUri(document, line)})`,
	);
	return md;
}

class GitBlameTimelineItem extends vscode.TreeItem {
	constructor(
		readonly blame: LineBlame,
		readonly line: number,
		readonly documentUri: vscode.Uri,
	) {
		super(formatTimelineLabel(blame), vscode.TreeItemCollapsibleState.None);

		this.description = `Line ${line + 1}`;
		this.tooltip =
			blame.hash === UNCOMMITTED_HASH
				? 'Uncommitted changes'
				: `${blame.commit.summary}\n${blame.hash}`;
		this.contextValue = 'snowCliGitBlameTimelineItem';
		this.iconPath = new vscode.ThemeIcon(
			blame.hash === UNCOMMITTED_HASH ? 'edit' : 'git-commit',
		);
		this.command = {
			command: 'vscode.open',
			title: 'Open Line',
			arguments: [
				documentUri,
				{
					selection: new vscode.Range(line, 0, line, 0),
				},
			],
		};
	}
}

class GitBlameTimelineProvider
	implements vscode.TreeDataProvider<GitBlameTimelineItem>
{
	private readonly changeEmitter = new vscode.EventEmitter<
		GitBlameTimelineItem | undefined | null | void
	>();
	private document: vscode.TextDocument | undefined;
	private lines: (LineBlame | undefined)[] = [];
	private focusLine = 0;

	readonly onDidChangeTreeData = this.changeEmitter.event;

	async show(document: vscode.TextDocument, focusLine: number): Promise<void> {
		this.document = document;
		this.focusLine = focusLine;
		this.lines = await getBlameData(document);
		this.changeEmitter.fire();
	}

	refresh(): void {
		this.changeEmitter.fire();
	}

	getTreeItem(element: GitBlameTimelineItem): vscode.TreeItem {
		return element;
	}

	getChildren(): GitBlameTimelineItem[] {
		if (!this.document) {
			return [];
		}

		const items: GitBlameTimelineItem[] = [];
		const seenHashes = new Set<string>();
		const orderedLines = [
			this.focusLine,
			...this.lines.map((_line, index) => index),
		];

		for (const line of orderedLines) {
			const blame = this.lines[line];
			if (!blame || seenHashes.has(blame.hash)) {
				continue;
			}
			seenHashes.add(blame.hash);
			items.push(new GitBlameTimelineItem(blame, line, this.document.uri));
		}

		return items;
	}
}

async function openGitBlameTimeline(
	documentUriString?: string,
	line?: number,
): Promise<void> {
	if (!enabled) {
		vscode.window.showInformationMessage(
			'Git Blame is disabled. Enable it in settings first.',
		);
		return;
	}

	const editor = vscode.window.activeTextEditor;
	const document = documentUriString
		? await vscode.workspace.openTextDocument(
				vscode.Uri.parse(documentUriString),
		  )
		: editor?.document;

	if (!document) {
		return;
	}

	const focusLine =
		typeof line === 'number' ? line : editor?.selection.active.line ?? 0;
	await timelineProvider?.show(document, focusLine);
	await vscode.commands.executeCommand(`${TIMELINE_VIEW_ID}.focus`);
}

async function updateCurrentLineBlame(
	editor: vscode.TextEditor,
): Promise<void> {
	if (!enabled) {
		editor.setDecorations(currentLineDecorationType, []);
		return;
	}

	const seq = ++updateSeq;
	const data = await getBlameData(editor.document);

	if (seq !== updateSeq) {
		return;
	}

	const line = editor.selection.active.line;
	const blame = data[line];
	if (!blame) {
		editor.setDecorations(currentLineDecorationType, []);
		return;
	}

	editor.setDecorations(currentLineDecorationType, [
		{
			range: new vscode.Range(
				line,
				Number.MAX_SAFE_INTEGER,
				line,
				Number.MAX_SAFE_INTEGER,
			),
			renderOptions: {after: {contentText: formatBlameAnnotation(blame)}},
			hoverMessage: createGitLineHover(editor.document, line, blame),
		},
	]);
}

async function showFileAnnotations(editor: vscode.TextEditor): Promise<void> {
	const data = await getBlameData(editor.document);
	const decorations: vscode.DecorationOptions[] = [];

	let maxAuthorLen = 0;
	for (let i = 0, len = data.length; i < len; i++) {
		const b = data[i];
		if (!b) {
			continue;
		}
		const nameLen = b.hash === UNCOMMITTED_HASH ? 3 : b.commit.author.length;
		if (nameLen > maxAuthorLen) {
			maxAuthorLen = nameLen;
		}
	}
	if (maxAuthorLen > 20) {
		maxAuthorLen = 20;
	}

	for (let i = 0, len = data.length; i < len; i++) {
		const blame = data[i];
		if (!blame) {
			continue;
		}
		decorations.push({
			range: new vscode.Range(i, 0, i, 0),
			renderOptions: {
				before: {contentText: formatFileAnnotation(blame, maxAuthorLen)},
			},
			hoverMessage: createGitLineHover(editor.document, i, blame),
		});
	}

	editor.setDecorations(fileAnnotationDecorationType, decorations);
}

function clearFileAnnotations(editor: vscode.TextEditor): void {
	editor.setDecorations(fileAnnotationDecorationType, []);
}

function clearAllDecorations(): void {
	for (const editor of vscode.window.visibleTextEditors) {
		editor.setDecorations(currentLineDecorationType, []);
		editor.setDecorations(fileAnnotationDecorationType, []);
	}
}

function onConfigChanged(): void {
	const newEnabled = vscode.workspace
		.getConfiguration('snow-cli')
		.get<boolean>('gitBlame.enabled', false);

	if (newEnabled !== enabled) {
		enabled = newEnabled;
		if (!enabled) {
			cancelPendingBlame();
			clearAllDecorations();
			fileAnnotationsActive = false;
			timelineProvider?.refresh();
		} else {
			const editor = vscode.window.activeTextEditor;
			if (editor) {
				updateCurrentLineBlame(editor);
			}
		}
	}
}

export function registerGitBlame(context: vscode.ExtensionContext): void {
	enabled = vscode.workspace
		.getConfiguration('snow-cli')
		.get<boolean>('gitBlame.enabled', false);

	createDecorationTypes();
	timelineProvider = new GitBlameTimelineProvider();
	context.subscriptions.push(
		currentLineDecorationType,
		fileAnnotationDecorationType,
		vscode.window.registerTreeDataProvider(TIMELINE_VIEW_ID, timelineProvider),
	);

	if (enabled) {
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			updateCurrentLineBlame(editor);
		}
	}

	let selectionTimer: ReturnType<typeof setTimeout> | undefined;
	let editorSwitchTimer: ReturnType<typeof setTimeout> | undefined;

	context.subscriptions.push(
		vscode.window.onDidChangeTextEditorSelection(e => {
			if (!enabled) {
				return;
			}
			if (selectionTimer) {
				clearTimeout(selectionTimer);
			}
			selectionTimer = setTimeout(
				() => updateCurrentLineBlame(e.textEditor),
				80,
			);
		}),

		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (!enabled || !editor) {
				return;
			}
			if (editorSwitchTimer) {
				clearTimeout(editorSwitchTimer);
			}
			editorSwitchTimer = setTimeout(() => {
				updateCurrentLineBlame(editor);
				if (fileAnnotationsActive) {
					showFileAnnotations(editor);
				}
			}, 50);
		}),

		vscode.workspace.onDidSaveTextDocument(doc => {
			blameCacheMap.delete(doc.uri.fsPath);
			if (!enabled) {
				return;
			}
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document === doc) {
				updateCurrentLineBlame(editor);
				if (fileAnnotationsActive) {
					showFileAnnotations(editor);
				}
			}
		}),

		vscode.commands.registerCommand('snow-cli.toggleGitBlame', () => {
			const config = vscode.workspace.getConfiguration('snow-cli');
			const current = config.get<boolean>('gitBlame.enabled', false);
			config.update(
				'gitBlame.enabled',
				!current,
				vscode.ConfigurationTarget.Global,
			);
		}),

		vscode.commands.registerCommand(
			OPEN_TIMELINE_COMMAND,
			(documentUriString?: string, line?: number) =>
				openGitBlameTimeline(documentUriString, line),
		),

		vscode.commands.registerCommand('snow-cli.toggleFileAnnotations', () => {
			if (!enabled) {
				vscode.window.showInformationMessage(
					'Git Blame is disabled. Enable it in settings first.',
				);
				return;
			}
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}
			fileAnnotationsActive = !fileAnnotationsActive;
			if (fileAnnotationsActive) {
				showFileAnnotations(editor);
			} else {
				clearFileAnnotations(editor);
			}
		}),

		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('snow-cli.gitBlame.enabled')) {
				onConfigChanged();
			}
		}),
	);
}
