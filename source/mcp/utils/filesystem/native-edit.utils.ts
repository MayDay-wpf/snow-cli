import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export type NativeMatch = {
	startLine: number;
	endLine: number;
	similarity: number;
	/** Inline substring match: 0-based UTF-16 column range within startLine (end exclusive). Absent for whole-line/multi-line matches. */
	startColumn?: number | null;
	endColumn?: number | null;
};

export type NativeTextEdit = {
	kind: 'replace' | 'insert_after' | 'delete';
	startLine: number;
	endLine: number;
	content?: string;
};

export type NativeDirectoryEntry = {
	/** Path relative to the scanned root, forward slashes, no `./` prefix. */
	relativePath: string;
	isDirectory: boolean;
	/** File size in bytes (0 for directories). */
	size: number;
};

export type NativeDirectoryScanResult = {
	entries: NativeDirectoryEntry[];
	/** True when a directory was skipped because it exceeded `maxDepth`. */
	depthLimitHit: boolean;
};

type NativeEditAccelerator = {
	scanFuzzyMatches: (
		content: string,
		search: string,
		threshold: number,
		maxMatches: number,
		usePreFilter: boolean,
		preFilterThreshold: number,
	) => Promise<NativeMatch[]>;
	applyTextEdits: (content: string, edits: NativeTextEdit[]) => Promise<string>;
	readFile: (path: string) => Promise<string>;
	writeFile: (path: string, content: string) => Promise<void>;
	scanDirectoryTree: (
		root: string,
		maxDepth: number,
		gitignoreContent?: string | null,
	) => Promise<NativeDirectoryScanResult>;
};

let accelerator: NativeEditAccelerator | null | undefined;

function getNativeEditAccelerator(): NativeEditAccelerator | undefined {
	if (accelerator !== undefined) return accelerator ?? undefined;

	try {
		const nativePath = fileURLToPath(
			new URL(
				`./native/snow_native.${process.platform}-${process.arch}.node`,
				import.meta.url,
			),
		);
		if (!existsSync(nativePath)) {
			accelerator = null;
			return undefined;
		}

		accelerator = createRequire(import.meta.url)(
			nativePath,
		) as NativeEditAccelerator;
		return accelerator;
	} catch {
		accelerator = null;
		return undefined;
	}
}

export async function scanFuzzyMatchesWithNative(
	content: string,
	search: string,
	threshold: number,
	maxMatches: number,
	usePreFilter: boolean,
	preFilterThreshold: number,
): Promise<NativeMatch[] | undefined> {
	try {
		return await getNativeEditAccelerator()?.scanFuzzyMatches(
			content,
			search,
			threshold,
			maxMatches,
			usePreFilter,
			preFilterThreshold,
		);
	} catch {
		return undefined;
	}
}

export async function applyTextEditsWithNative(
	content: string,
	edits: NativeTextEdit[],
): Promise<string | undefined> {
	try {
		return await getNativeEditAccelerator()?.applyTextEdits(content, edits);
	} catch {
		return undefined;
	}
}

export async function readFileWithNative(
	path: string,
): Promise<string | undefined> {
	try {
		return await getNativeEditAccelerator()?.readFile(path);
	} catch {
		return undefined;
	}
}

export async function writeFileWithNative(
	path: string,
	content: string,
): Promise<boolean> {
	try {
		const accel = getNativeEditAccelerator();
		if (!accel) return false;
		await accel.writeFile(path, content);
		return true;
	} catch {
		return false;
	}
}

export async function scanDirectoryTreeWithNative(
	root: string,
	maxDepth: number,
	gitignoreContent?: string | null,
): Promise<NativeDirectoryScanResult | undefined> {
	try {
		return await getNativeEditAccelerator()?.scanDirectoryTree(
			root,
			maxDepth,
			gitignoreContent,
		);
	} catch {
		return undefined;
	}
}
