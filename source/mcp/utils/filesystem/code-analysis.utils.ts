/**
 * Code analysis utilities for structure validation
 */

import type {StructureAnalysis} from '../../types/filesystem.types.js';

/**
 * Analyze code structure for balance and completeness
 * Helps AI identify bracket mismatches, unclosed tags, and boundary issues
 */
export function analyzeCodeStructure(
	_content: string,
	filePath: string,
	editedLines: string[],
): StructureAnalysis {
	const analysis: StructureAnalysis = {
		bracketBalance: {
			curly: {open: 0, close: 0, balanced: true},
			round: {open: 0, close: 0, balanced: true},
			square: {open: 0, close: 0, balanced: true},
		},
		indentationWarnings: [],
	};

	// Count brackets in the edited content
	const editedContent = editedLines.join('\n');

	// Remove string literals and comments to avoid false positives
	const cleanContent = editedContent
		.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '""') // Remove strings
		.replace(/\/\/.*$/gm, '') // Remove single-line comments
		.replace(/\/\*[\s\S]*?\*\//g, ''); // Remove multi-line comments

	// Count brackets
	analysis.bracketBalance.curly.open = (cleanContent.match(/\{/g) || []).length;
	analysis.bracketBalance.curly.close = (
		cleanContent.match(/\}/g) || []
	).length;
	analysis.bracketBalance.curly.balanced =
		analysis.bracketBalance.curly.open === analysis.bracketBalance.curly.close;

	analysis.bracketBalance.round.open = (cleanContent.match(/\(/g) || []).length;
	analysis.bracketBalance.round.close = (
		cleanContent.match(/\)/g) || []
	).length;
	analysis.bracketBalance.round.balanced =
		analysis.bracketBalance.round.open === analysis.bracketBalance.round.close;

	analysis.bracketBalance.square.open = (
		cleanContent.match(/\[/g) || []
	).length;
	analysis.bracketBalance.square.close = (
		cleanContent.match(/\]/g) || []
	).length;
	analysis.bracketBalance.square.balanced =
		analysis.bracketBalance.square.open ===
		analysis.bracketBalance.square.close;

	// HTML/JSX tag analysis (for .html, .jsx, .tsx, .vue files)
	const isMarkupFile = /\.(html|jsx|tsx|vue)$/i.test(filePath);
	if (isMarkupFile) {
		const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9-]*)[^>]*>/g;
		const selfClosingPattern = /<[a-zA-Z][a-zA-Z0-9-]*[^>]*\/>/g;

		// Remove self-closing tags
		const contentWithoutSelfClosing = cleanContent.replace(
			selfClosingPattern,
			'',
		);

		const tags: string[] = [];
		const unclosedTags: string[] = [];
		const unopenedTags: string[] = [];

		let match;
		while ((match = tagPattern.exec(contentWithoutSelfClosing)) !== null) {
			const isClosing = match[0]?.startsWith('</');
			const tagName = match[1]?.toLowerCase();

			if (!tagName) continue;

			if (isClosing) {
				const lastOpenTag = tags.pop();
				if (!lastOpenTag || lastOpenTag !== tagName) {
					unopenedTags.push(tagName);
					if (lastOpenTag) tags.push(lastOpenTag); // Put it back
				}
			} else {
				tags.push(tagName);
			}
		}

		unclosedTags.push(...tags);

		analysis.htmlTags = {
			unclosedTags,
			unopenedTags,
			balanced: unclosedTags.length === 0 && unopenedTags.length === 0,
		};
	}

	// Check indentation consistency
	const lines = editedContent.split('\n');
	const indents = lines
		.filter(line => line.trim().length > 0)
		.map(line => {
			const match = line.match(/^(\s*)/);
			return match ? match[1] : '';
		})
		.filter((indent): indent is string => indent !== undefined);

	// Detect mixed tabs/spaces
	const hasTabs = indents.some(indent => indent.includes('\t'));
	const hasSpaces = indents.some(indent => indent.includes(' '));
	if (hasTabs && hasSpaces) {
		analysis.indentationWarnings.push('Mixed tabs and spaces detected');
	}

	// Detect inconsistent indentation levels (spaces only)
	if (!hasTabs && hasSpaces) {
		const spaceCounts = indents
			.filter(indent => indent.length > 0)
			.map(indent => indent.length);

		if (spaceCounts.length > 1) {
			const gcd = spaceCounts.reduce((a, b) => {
				while (b !== 0) {
					const temp = b;
					b = a % b;
					a = temp;
				}
				return a;
			});

			const hasInconsistent = spaceCounts.some(
				count => count % gcd !== 0 && gcd > 1,
			);
			if (hasInconsistent) {
				analysis.indentationWarnings.push(
					`Inconsistent indentation (expected multiples of ${gcd} spaces)`,
				);
			}
		}
	}

	// Note: Boundary checking removed - AI should be free to edit partial code blocks
	// The bracket balance check above is sufficient for detecting real issues

	return analysis;
}

/**
 * Find smart context boundaries for editing
 * Expands context to include complete code blocks when possible
 */
export function findSmartContextBoundaries(
	lines: string[],
	startLine: number,
	endLine: number,
	requestedContext: number,
): {start: number; end: number; extended: boolean} {
	const totalLines = lines.length;
	let contextStart = Math.max(1, startLine - requestedContext);
	let contextEnd = Math.min(totalLines, endLine + requestedContext);
	let extended = false;

	// Try to find the start of the enclosing block
	let bracketDepth = 0;
	for (let i = startLine - 1; i >= Math.max(0, startLine - 50); i--) {
		const line = lines[i];
		if (!line) continue;

		const trimmed = line.trim();

		// Count brackets (simple approach)
		const openBrackets = (line.match(/\{/g) || []).length;
		const closeBrackets = (line.match(/\}/g) || []).length;
		bracketDepth += closeBrackets - openBrackets;

		// If we find a function/class/block definition with balanced brackets
		if (
			bracketDepth === 0 &&
			(trimmed.match(
				/^(function|class|const|let|var|if|for|while|async|export)\s/i,
			) ||
				trimmed.match(/=>\s*\{/) ||
				trimmed.match(/^\w+\s*\(/))
		) {
			if (i + 1 < contextStart) {
				contextStart = i + 1;
				extended = true;
			}
			break;
		}
	}

	// Try to find the end of the enclosing block
	bracketDepth = 0;
	for (let i = endLine - 1; i < Math.min(totalLines, endLine + 50); i++) {
		const line = lines[i];
		if (!line) continue;

		const trimmed = line.trim();

		// Count brackets
		const openBrackets = (line.match(/\{/g) || []).length;
		const closeBrackets = (line.match(/\}/g) || []).length;
		bracketDepth += openBrackets - closeBrackets;

		// If we find a closing bracket at depth 0
		if (bracketDepth === 0 && trimmed.startsWith('}')) {
			if (i + 1 > contextEnd) {
				contextEnd = i + 1;
				extended = true;
			}
			break;
		}
	}

	return {start: contextStart, end: contextEnd, extended};
}
