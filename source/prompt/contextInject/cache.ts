import type {InjectRenderResult} from './types.js';

type CacheRecord = {
	result: InjectRenderResult;
	fileMtimes: Map<string, number>;
};

const cache = new Map<string, CacheRecord>();

export function buildCacheKey(
	cwd: string,
	profile: string,
	configFingerprint: string,
): string {
	return `${cwd}|${profile}|${configFingerprint}`;
}

export function fingerprintConfig(config: unknown): string {
	try {
		return JSON.stringify(config);
	} catch {
		return String(config);
	}
}

export function getCachedInjectResult(
	key: string,
	currentMtimes: Map<string, number>,
): InjectRenderResult | null {
	const hit = cache.get(key);
	if (!hit) return null;

	if (hit.fileMtimes.size !== currentMtimes.size) {
		return null;
	}

	for (const [file, mtime] of currentMtimes) {
		if (hit.fileMtimes.get(file) !== mtime) {
			return null;
		}
	}

	return hit.result;
}

export function setCachedInjectResult(
	key: string,
	result: InjectRenderResult,
	fileMtimes: Map<string, number>,
): void {
	cache.set(key, {
		result,
		fileMtimes: new Map(fileMtimes),
	});
}

export function clearContextInjectCache(): void {
	cache.clear();
}
