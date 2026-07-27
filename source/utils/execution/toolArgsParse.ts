import {parseJsonWithFix} from '../core/retryUtils.js';

const TOOL_ARGS_PREVIEW_LIMIT = 200;

export type ToolArgsParseResult =
	| {ok: true; args: Record<string, any>; repaired?: boolean}
	| {ok: false; error: string; rawPreview?: string};

/**
 * Extract the first complete top-level JSON object substring.
 * Handles concatenated payloads like `{"a":1}{"b":2}`.
 */
function extractFirstJsonObject(argsString: string): string | null {
	const firstBraceIndex = argsString.indexOf('{');
	if (firstBraceIndex === -1) {
		return null;
	}

	let braceCount = 0;
	let inString = false;
	let escapeNext = false;

	for (let i = firstBraceIndex; i < argsString.length; i++) {
		const char = argsString[i];

		if (escapeNext) {
			escapeNext = false;
			continue;
		}

		if (char === '\\') {
			escapeNext = true;
			continue;
		}

		if (char === '"') {
			inString = !inString;
			continue;
		}

		if (!inString) {
			if (char === '{') {
				braceCount++;
			} else if (char === '}') {
				braceCount--;
				if (braceCount === 0) {
					return argsString.substring(firstBraceIndex, i + 1);
				}
			}
		}
	}

	return null;
}

function previewToolArguments(argsString: string): string {
	const compact = argsString.replace(/\s+/g, ' ').trim();
	if (compact.length <= TOOL_ARGS_PREVIEW_LIMIT) {
		return compact;
	}
	return `${compact.slice(0, TOOL_ARGS_PREVIEW_LIMIT)}...`;
}

function asArgsRecord(value: unknown): Record<string, any> | null {
	if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
		return value as Record<string, any>;
	}
	return null;
}

/**
 * Detailed tool-argument parser for execution paths.
 * Empty / whitespace-only input is valid and becomes {}.
 * Soft scheduling paths should keep using safeParseToolArguments.
 */
export function parseToolArgumentsDetailed(
	argsString: string,
): ToolArgsParseResult {
	if (!argsString || argsString.trim() === '') {
		return {ok: true, args: {}};
	}

	const rawPreview = previewToolArguments(argsString);

	try {
		const parsed = JSON.parse(argsString);
		const args = asArgsRecord(parsed);
		if (args) {
			return {ok: true, args};
		}
		return {
			ok: false,
			error: `Tool arguments must be a JSON object, got ${
				Array.isArray(parsed) ? 'array' : typeof parsed
			}`,
			rawPreview,
		};
	} catch {
		// Fall through to repair strategies for concatenated / slightly malformed JSON.
	}

	const firstJsonObject = extractFirstJsonObject(argsString);
	if (firstJsonObject) {
		try {
			const parsed = JSON.parse(firstJsonObject);
			const args = asArgsRecord(parsed);
			if (args) {
				return {ok: true, args, repaired: true};
			}
		} catch {
			const fixed = parseJsonWithFix(firstJsonObject, {
				logWarning: false,
				logError: false,
			});
			if (fixed.success) {
				const args = asArgsRecord(fixed.data);
				if (args) {
					return {
						ok: true,
						args,
						repaired: true,
					};
				}
			}
		}
	}

	// Last chance: try parseJsonWithFix on the full original string.
	const fixedFull = parseJsonWithFix(argsString, {
		logWarning: false,
		logError: false,
	});
	if (fixedFull.success) {
		const args = asArgsRecord(fixedFull.data);
		if (args) {
			return {
				ok: true,
				args,
				repaired: Boolean(fixedFull.wasFixed),
			};
		}
	}

	return {
		ok: false,
		error: 'Invalid tool arguments JSON',
		rawPreview,
	};
}

/**
 * Soft-parse tool arguments for scheduling / resource grouping.
 * Never throws; returns {} on complete parse failure.
 */
export function safeParseToolArguments(
	argsString: string,
): Record<string, any> {
	const result = parseToolArgumentsDetailed(argsString);
	return result.ok ? result.args : {};
}
