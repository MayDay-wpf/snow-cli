import {
	vscodeConnection,
	type Diagnostic,
} from '../../../utils/ui/vscodeConnection.js';

function sleep(ms: number): Promise<void> {
	return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function getDiagnosticFingerprint(diagnostics: Diagnostic[]): string {
	if (diagnostics.length === 0) {
		return 'empty';
	}

	return diagnostics
		.map(
			diagnostic =>
				`${diagnostic.severity}|${diagnostic.source || ''}|${diagnostic.code || ''}|${diagnostic.line}|${diagnostic.character}|${diagnostic.message}`,
		)
		.sort()
		.join('\n');
}

/**
 * Poll IDE diagnostics until they become stable after file edits.
 * This reduces the chance of returning stale diagnostics right after save.
 */
export async function getFreshDiagnostics(filePath: string): Promise<Diagnostic[]> {
	const initialDelayMs = 300;
	const pollDelayMs = 350;
	const maxAttempts = 5;
	const requestTimeoutMs = 3000;
	let lastFingerprint: string | null = null;
	let lastDiagnostics: Diagnostic[] = [];

	await sleep(initialDelayMs);

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const diagnostics = await Promise.race([
			vscodeConnection.requestDiagnostics(filePath),
			new Promise<Diagnostic[]>(resolve =>
				setTimeout(() => resolve([]), requestTimeoutMs),
			),
		]);

		const fingerprint = getDiagnosticFingerprint(diagnostics);
		if (fingerprint === lastFingerprint) {
			return diagnostics;
		}

		lastFingerprint = fingerprint;
		lastDiagnostics = diagnostics;

		if (attempt < maxAttempts - 1) {
			await sleep(pollDelayMs);
		}
	}

	return lastDiagnostics;
}
