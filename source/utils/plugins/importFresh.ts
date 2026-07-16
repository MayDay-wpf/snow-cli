import {createRequire} from 'node:module';
import {dirname, extname, sep} from 'node:path';
import {pathToFileURL} from 'node:url';

const localRequire = createRequire(import.meta.url);
let esmImportSequence = 0;

function clearCommonJsCache(
	moduleId: string,
	pluginRoot: string,
	visited: Set<string> = new Set(),
): void {
	if (visited.has(moduleId)) return;
	visited.add(moduleId);

	const cached = localRequire.cache[moduleId];
	if (!cached) return;
	// Delete before walking children so CommonJS dependency cycles cannot recurse
	// back into the same cached module indefinitely.
	delete localRequire.cache[moduleId];
	const rootPrefix = pluginRoot.endsWith(sep)
		? pluginRoot
		: `${pluginRoot}${sep}`;
	for (const child of cached.children) {
		if (child.id === pluginRoot || child.id.startsWith(rootPrefix)) {
			clearCommonJsCache(child.id, pluginRoot, visited);
		}
	}
}

function wrapCommonJsModule(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object'
		? {default: value, ...(value as Record<string, unknown>)}
		: {default: value};
}

/** Load plugin code without reusing ESM or CommonJS module caches. */
export async function importFreshPluginModule(
	modulePath: string,
): Promise<Record<string, unknown>> {
	const extension = extname(modulePath).toLowerCase();
	if (extension === '.cjs' || extension === '.js') {
		try {
			const moduleId = localRequire.resolve(modulePath);
			clearCommonJsCache(moduleId, dirname(modulePath));
			return wrapCommonJsModule(localRequire(moduleId));
		} catch (error) {
			const code = (error as NodeJS.ErrnoException | undefined)?.code;
			if (extension === '.cjs' || code !== 'ERR_REQUIRE_ESM') {
				throw error;
			}
		}
	}

	const moduleUrl = `${
		pathToFileURL(modulePath).href
	}?t=${Date.now()}-${++esmImportSequence}`;
	return (await import(moduleUrl)) as Record<string, unknown>;
}
