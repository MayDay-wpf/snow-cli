import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import process from 'node:process';
import {measurePlanOperation} from './plan-metrics.js';

function ignoreCleanupError(): undefined {
	return undefined;
}

function isAlreadyExistsError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error as {code?: unknown}).code === 'EEXIST'
	);
}

export async function createPlanFileExclusively(
	filePath: string,
	content: string,
): Promise<boolean> {
	return measurePlanOperation(
		{operation: 'write', detail: 'create'},
		async () => {
			try {
				await fs.writeFile(filePath, content, {
					encoding: 'utf8',
					flag: 'wx',
				});
				return true;
			} catch (error) {
				if (isAlreadyExistsError(error)) {
					return false;
				}

				throw error;
			}
		},
	);
}

export async function replacePlanFileAtomically(
	filePath: string,
	content: string,
): Promise<void> {
	await measurePlanOperation(
		{operation: 'write', detail: 'replace'},
		async () => {
			const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
			let handle: Awaited<ReturnType<typeof fs.open>> | undefined;

			try {
				handle = await fs.open(temporaryPath, 'wx');
				await handle.writeFile(content, 'utf8');
				await handle.close();
				handle = undefined;
				await fs.rename(temporaryPath, filePath);
			} finally {
				await handle?.close().catch(ignoreCleanupError);
				await fs.unlink(temporaryPath).catch(ignoreCleanupError);
			}
		},
	);
}
