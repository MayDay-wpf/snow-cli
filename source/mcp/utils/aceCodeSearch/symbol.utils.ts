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
): Promise<CodeSymbol[]> {
	const symbols: CodeSymbol[] = [];
	const language = detectLanguage(filePath);

	if (!language || !LANGUAGE_CONFIG[language]) {
		return symbols;
	}

	const config = LANGUAGE_CONFIG[language];
	const lines = content.split('\n');

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
					// Get function signature (current line + next few lines)
					const contextLines = lines.slice(i, Math.min(i + 3, lines.length));
					const signature = contextLines.join('\n').trim();

					symbols.push({
						name,
						type: 'function',
						filePath: path.relative(basePath, filePath),
						line: lineNumber,
						column: line.indexOf(name) + 1,
						signature,
						language,
						context: getContext(lines, i, 2),
					});
				}
			}
		}

		// Extract classes
		if (config.symbolPatterns.class) {
			const match = line.match(config.symbolPatterns.class);
			if (match) {
				const name = match[1] || match[2] || match[3];
				if (name) {
					symbols.push({
						name,
						type: 'class',
						filePath: path.relative(basePath, filePath),
						line: lineNumber,
						column: line.indexOf(name) + 1,
						signature: line.trim(),
						language,
						context: getContext(lines, i, 2),
					});
				}
			}
		}

		// Extract variables
		if (config.symbolPatterns.variable) {
			const match = line.match(config.symbolPatterns.variable);
			if (match) {
				const name = match[1];
				if (name) {
					symbols.push({
						name,
						type: 'variable',
						filePath: path.relative(basePath, filePath),
						line: lineNumber,
						column: line.indexOf(name) + 1,
						signature: line.trim(),
						language,
						context: getContext(lines, i, 1),
					});
				}
			}
		}

		// Extract imports
		if (config.symbolPatterns.import) {
			const match = line.match(config.symbolPatterns.import);
			if (match) {
				const name = match[1] || match[2];
				if (name) {
					symbols.push({
						name,
						type: 'import',
						filePath: path.relative(basePath, filePath),
						line: lineNumber,
						column: line.indexOf(name) + 1,
						signature: line.trim(),
						language,
					});
				}
			}
		}

		// Extract exports
		if (config.symbolPatterns.export) {
			const match = line.match(config.symbolPatterns.export);
			if (match) {
				const name = match[1];
				if (name) {
					symbols.push({
						name,
						type: 'export',
						filePath: path.relative(basePath, filePath),
						line: lineNumber,
						column: line.indexOf(name) + 1,
						signature: line.trim(),
						language,
					});
				}
			}
		}
	}

	return symbols;
}
