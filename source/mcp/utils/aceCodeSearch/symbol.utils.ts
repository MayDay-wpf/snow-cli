/**
 * Symbol parsing utilities for ACE Code Search
 */

import * as path from 'path';
import type {CodeSymbol} from '../../types/aceCodeSearch.types.js';
import {LANGUAGE_CONFIG, detectLanguage} from './language.utils.js';

/**
 * Get context lines around a specific line
 * @param lines - All lines in file
 * @param lineIndex - Target line index (0-based)
 * @param contextSize - Number of lines before and after
 * @returns Context string
 */
export function getContext(
	lines: string[],
	lineIndex: number,
	contextSize: number,
): string {
	const start = Math.max(0, lineIndex - contextSize);
	const end = Math.min(lines.length, lineIndex + contextSize + 1);
	return lines
		.slice(start, end)
		.filter(l => l !== undefined)
		.join('\n')
		.trim();
}

interface ParseFileSymbolsOptions {
	includeContext?: boolean;
	includeSignature?: boolean;
	maxSymbols?: number;
}

/**
 * Parse file content to extract code symbols using regex patterns
 * @param filePath - Path to file
 * @param content - File content
 * @param basePath - Base path for relative path calculation
 * @returns Array of code symbols
 */
export async function parseFileSymbols(
	filePath: string,
	content: string,
	basePath: string,
	options: ParseFileSymbolsOptions = {},
): Promise<CodeSymbol[]> {
	const symbols: CodeSymbol[] = [];
	const language = detectLanguage(filePath);

	if (!language || !LANGUAGE_CONFIG[language]) {
		return symbols;
	}

	const {includeContext = true, includeSignature = true, maxSymbols} = options;
	const config = LANGUAGE_CONFIG[language];
	const lines = content.split('\n');
	const relativeFilePath = path.relative(basePath, filePath);
	const pushSymbol = (symbol: CodeSymbol): boolean => {
		symbols.push(symbol);
		return maxSymbols !== undefined && symbols.length >= maxSymbols;
	};

	// Parse each line for symbols
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		const lineNumber = i + 1;

		// Extract functions
		if (config.symbolPatterns.function) {
			const match = line.match(config.symbolPatterns.function);
			if (match) {
				const name = match[1] || match[2] || match[3];
				if (name) {
					const contextLines = lines.slice(i, Math.min(i + 3, lines.length));
					if (
						pushSymbol({
							name,
							type: 'function',
							filePath: relativeFilePath,
							line: lineNumber,
							column: line.indexOf(name) + 1,
							signature: includeSignature
								? contextLines.join('\n').trim()
								: undefined,
							language,
							context: includeContext ? getContext(lines, i, 2) : undefined,
						})
					) {
						return symbols;
					}
				}
			}
		}

		// Extract classes
		if (config.symbolPatterns.class) {
			const match = line.match(config.symbolPatterns.class);
			if (match) {
				const name = match[1] || match[2] || match[3];
				if (name) {
					if (
						pushSymbol({
							name,
							type: 'class',
							filePath: relativeFilePath,
							line: lineNumber,
							column: line.indexOf(name) + 1,
							signature: includeSignature ? line.trim() : undefined,
							language,
							context: includeContext ? getContext(lines, i, 2) : undefined,
						})
					) {
						return symbols;
					}
				}
			}
		}

		// Extract variables
		if (config.symbolPatterns.variable) {
			const match = line.match(config.symbolPatterns.variable);
			if (match) {
				const name = match[1];
				if (name) {
					if (
						pushSymbol({
							name,
							type: 'variable',
							filePath: relativeFilePath,
							line: lineNumber,
							column: line.indexOf(name) + 1,
							signature: includeSignature ? line.trim() : undefined,
							language,
							context: includeContext ? getContext(lines, i, 1) : undefined,
						})
					) {
						return symbols;
					}
				}
			}
		}

		// Extract imports
		if (config.symbolPatterns.import) {
			const match = line.match(config.symbolPatterns.import);
			if (match) {
				const name = match[1] || match[2];
				if (name) {
					if (
						pushSymbol({
							name,
							type: 'import',
							filePath: relativeFilePath,
							line: lineNumber,
							column: line.indexOf(name) + 1,
							signature: includeSignature ? line.trim() : undefined,
							language,
						})
					) {
						return symbols;
					}
				}
			}
		}

		// Extract exports
		if (config.symbolPatterns.export) {
			const match = line.match(config.symbolPatterns.export);
			if (match) {
				const name = match[1];
				if (name) {
					if (
						pushSymbol({
							name,
							type: 'export',
							filePath: relativeFilePath,
							line: lineNumber,
							column: line.indexOf(name) + 1,
							signature: includeSignature ? line.trim() : undefined,
							language,
						})
					) {
						return symbols;
					}
				}
			}
		}
	}

	return symbols;
}
