import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

type NativePhantomCleaner = {
	sweepPhantomWindows: () => Promise<number>;
};

let cleaner: NativePhantomCleaner | null | undefined;

function getNativePhantomCleaner(): NativePhantomCleaner | undefined {
	if (cleaner !== undefined) return cleaner ?? undefined;

	try {
		const nativePath = fileURLToPath(
			new URL(
				`./native/snow_native.${process.platform}-${process.arch}.node`,
				import.meta.url,
			),
		);
		if (!existsSync(nativePath)) {
			cleaner = null;
			return undefined;
		}

		cleaner = createRequire(import.meta.url)(
			nativePath,
		) as NativePhantomCleaner;
		return cleaner;
	} catch {
		cleaner = null;
		return undefined;
	}
}

/**
 * Sweep orphaned Chromium/Edge top-level windows (e.g. Edge's
 * `EdgeUiInputTopWndClass` input windows) whose owning process has already
 * exited — the source of blank "phantom" Alt+Tab entries after Edge/Chrome
 * closes.
 *
 * Only windows owned by dead processes are touched; windows of running
 * browsers are never affected. Returns the number of windows destroyed.
 * Returns 0 when the native module is unavailable or on non-Windows.
 */
export async function sweepPhantomWindows(): Promise<number> {
	if (process.platform !== 'win32') {
		return 0;
	}

	const native = getNativePhantomCleaner();
	if (!native) {
		return 0;
	}

	try {
		return await native.sweepPhantomWindows();
	} catch {
		// Native sweep failed — treat as nothing swept
		return 0;
	}
}
