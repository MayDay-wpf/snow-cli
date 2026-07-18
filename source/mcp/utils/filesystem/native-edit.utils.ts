import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export type NativeMatch = {
	startLine: number;
	endLine: number;
	similarity: number;
};

export type NativeTextEdit = {
	kind: 'replace' | 'insert_after' | 'delete';
	startLine: number;
	endLine: number;
	content?: string;
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
