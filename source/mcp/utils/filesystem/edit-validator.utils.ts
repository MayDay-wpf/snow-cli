/**
 * Edit validation utilities for pre-edit boundary checking
 * Validates code completeness before allowing edits to prevent syntax errors
 */

/**
 * Validation result for code boundaries
 */
export interface ValidationResult {
	isValid: boolean;
	errors: string[];
	warnings: string[];
	details?: {
		brackets?: {
			curly: {open: number; close: number; diff: number};
			round: {open: number; close: number; diff: number};
			square: {open: number; close: number; diff: number};
			angle?: {open: number; close: number; diff: number}; // For generics in some languages
		};
		tags?: {
			unclosed: string[];
			unopened: string[];
		};
		strings?: {
			unclosed: boolean;
			type?: 'single' | 'double' | 'template' | 'multiline';
		};
	};
}

/**
 * Language-specific validation rules
 */
interface LanguageRules {
	// Comment patterns
	singleLineComment: RegExp[];
	multiLineComment: Array<{start: RegExp; end: RegExp}>;

	// String patterns
	stringPatterns: RegExp[];

	// Whether to validate HTML/XML tags
	validateTags: boolean;

	// Whether to check indentation
	checkIndentation: boolean;

	// Special features
	hasTemplateStrings: boolean;
	hasRegex: boolean;
}

/**
 * Get language rules based on file extension or content hints
 */
function getLanguageRules(filePath?: string, _content?: string): LanguageRules {
	const ext = filePath?.toLowerCase() || '';

	// JavaScript/TypeScript family
	if (ext.match(/\.(js|jsx|ts|tsx|mjs|cjs)$/)) {
		return {
			singleLineComment: [/\/\/.*/],
			multiLineComment: [{start: /\/\*/, end: /\*\//}],
			stringPatterns: [
				/"(?:\\.|[^"\\])*"/g, // Double quotes
				/'(?:\\.|[^'\\])*'/g, // Single quotes
				/`(?:\\.|[^`\\])*`/g, // Template literals
			],
			validateTags: ext.match(/\.(jsx|tsx)$/) !== null,
			checkIndentation: true,
			hasTemplateStrings: true,
			hasRegex: true,
		};
	}

	// HTML/XML/Vue family
	if (ext.match(/\.(html|xml|vue|svelte)$/)) {
		return {
			singleLineComment: [],
			multiLineComment: [{start: /<!--/, end: /-->/}],
			stringPatterns: [/"(?:\\.|[^"\\])*"/g, /'(?:\\.|[^'\\])*'/g],
			validateTags: true,
			checkIndentation: false,
			hasTemplateStrings: false,
			hasRegex: false,
		};
	}

	// Python
	if (ext.match(/\.py$/)) {
		return {
			singleLineComment: [/#.*/],
			multiLineComment: [
				{start: /'''/, end: /'''/},
				{start: /"""/, end: /"""/},
			],
			stringPatterns: [
				/"(?:\\.|[^"\\])*"/g,
				/'(?:\\.|[^'\\])*'/g,
				/'''(?:[^\\]|\\.)*?'''/g,
				/"""(?:[^\\]|\\.)*?"""/g,
			],
			validateTags: false,
			checkIndentation: true,
			hasTemplateStrings: false,
			hasRegex: true,
		};
	}

	// Go
	if (ext.match(/\.go$/)) {
		return {
			singleLineComment: [/\/\/.*/],
			multiLineComment: [{start: /\/\*/, end: /\*\//}],
			stringPatterns: [
				/"(?:\\.|[^"\\])*"/g,
				/`[^`]*`/g, // Raw strings
			],
			validateTags: false,
			checkIndentation: false,
			hasTemplateStrings: false,
			hasRegex: true,
		};
	}

	// Rust
	if (ext.match(/\.rs$/)) {
		return {
			singleLineComment: [/\/\/.*/],
			multiLineComment: [{start: /\/\*/, end: /\*\//}],
			stringPatterns: [
				/"(?:\\.|[^"\\])*"/g,
				/r#*"[^"]*"#*/g, // Raw strings
			],
			validateTags: false,
			checkIndentation: false,
			hasTemplateStrings: false,
			hasRegex: true,
		};
	}

	// Java/C#/C/C++
	if (ext.match(/\.(java|cs|c|cpp|h|hpp)$/)) {
		return {
			singleLineComment: [/\/\/.*/],
			multiLineComment: [{start: /\/\*/, end: /\*\//}],
			stringPatterns: [/"(?:\\.|[^"\\])*"/g, /'(?:\\.|[^'\\])*'/g],
			validateTags: false,
			checkIndentation: false,
			hasTemplateStrings: false,
			hasRegex: false,
		};
	}

	// Ruby
	if (ext.match(/\.rb$/)) {
		return {
			singleLineComment: [/#.*/],
			multiLineComment: [{start: /^=begin/, end: /^=end/}],
			stringPatterns: [/"(?:\\.|[^"\\])*"/g, /'(?:\\.|[^'\\])*'/g],
			validateTags: false,
			checkIndentation: true,
			hasTemplateStrings: false,
			hasRegex: true,
		};
	}

	// PHP
	if (ext.match(/\.php$/)) {
		return {
			singleLineComment: [/\/\/.*/, /#.*/],
			multiLineComment: [{start: /\/\*/, end: /\*\//}],
			stringPatterns: [/"(?:\\.|[^"\\])*"/g, /'(?:\\.|[^'\\])*'/g],
			validateTags: true, // PHP can have HTML
			checkIndentation: false,
			hasTemplateStrings: false,
			hasRegex: true,
		};
	}

	// Default/Generic rules
	return {
		singleLineComment: [/\/\/.*/, /#.*/],
		multiLineComment: [{start: /\/\*/, end: /\*\//}],
		stringPatterns: [/"(?:\\.|[^"\\])*"/g, /'(?:\\.|[^'\\])*'/g],
		validateTags: false,
		checkIndentation: false,
		hasTemplateStrings: false,
		hasRegex: false,
	};
}

/**
 * Remove comments from code while preserving string positions
 */
function removeComments(code: string, rules: LanguageRules): string {
	let result = code;

	// Remove multi-line comments first
	for (const pattern of rules.multiLineComment) {
		const regex = new RegExp(
			`${pattern.start.source}[\\s\\S]*?${pattern.end.source}`,
			'g',
		);
		result = result.replace(regex, match => ' '.repeat(match.length));
	}

	// Remove single-line comments
	for (const pattern of rules.singleLineComment) {
		result = result.replace(pattern, match => ' '.repeat(match.length));
	}

	return result;
}

/**
 * Remove string literals from code while preserving positions
 */
function removeStrings(code: string, rules: LanguageRules): string {
	let result = code;

	for (const pattern of rules.stringPatterns) {
		result = result.replace(pattern, match => ' '.repeat(match.length));
	}

	return result;
}

/**
 * Count brackets in cleaned code
 */
function countBrackets(cleanCode: string): {
	curly: {open: number; close: number; diff: number};
	round: {open: number; close: number; diff: number};
	square: {open: number; close: number; diff: number};
	angle: {open: number; close: number; diff: number};
} {
	const curlyOpen = (cleanCode.match(/\{/g) || []).length;
	const curlyClose = (cleanCode.match(/\}/g) || []).length;

	const roundOpen = (cleanCode.match(/\(/g) || []).length;
	const roundClose = (cleanCode.match(/\)/g) || []).length;

	const squareOpen = (cleanCode.match(/\[/g) || []).length;
	const squareClose = (cleanCode.match(/\]/g) || []).length;

	const angleOpen = (cleanCode.match(/</g) || []).length;
	const angleClose = (cleanCode.match(/>/g) || []).length;

	return {
		curly: {open: curlyOpen, close: curlyClose, diff: curlyOpen - curlyClose},
		round: {open: roundOpen, close: roundClose, diff: roundOpen - roundClose},
		square: {
			open: squareOpen,
			close: squareClose,
			diff: squareOpen - squareClose,
		},
		angle: {open: angleOpen, close: angleClose, diff: angleOpen - angleClose},
	};
}

/**
 * Validate bracket balance using stack-based approach
 * This catches more complex errors like mismatched bracket types
 */
function validateBracketStack(cleanCode: string): {
	isValid: boolean;
	errors: string[];
} {
	const stack: Array<{char: string; pos: number}> = [];
	const pairs: Record<string, string> = {
		'{': '}',
		'(': ')',
		'[': ']',
	};
	const closingBrackets = new Set(Object.values(pairs));
	const errors: string[] = [];

	for (let i = 0; i < cleanCode.length; i++) {
		const char = cleanCode[i];

		// Opening bracket
		if (char && char in pairs) {
			stack.push({char, pos: i});
		}
		// Closing bracket
		else if (char && closingBrackets.has(char)) {
			if (stack.length === 0) {
				errors.push(
					`Unexpected closing bracket '${char}' at position ${i} with no matching opening`,
				);
				continue;
			}

			const last = stack.pop();
			if (last && pairs[last.char] !== char) {
				errors.push(
					`Mismatched brackets: expected '${
						pairs[last.char]
					}' but found '${char}' at position ${i}`,
				);
				// Put it back for further validation
				stack.push(last);
			}
		}
	}

	// Check for unclosed brackets
	if (stack.length > 0) {
		const unclosed = stack.map(b => b.char).join(', ');
		errors.push(`Unclosed brackets: ${unclosed}`);
	}

	return {
		isValid: errors.length === 0,
		errors,
	};
}

/**
 * Validate HTML/XML/JSX tags
 */
function validateTags(code: string): {
	isValid: boolean;
	unclosed: string[];
	unopened: string[];
} {
	// Remove strings first to avoid false positives
	const withoutStrings = code
		.replace(/"(?:\\.|[^"\\])*"/g, '""')
		.replace(/'(?:\\.|[^'\\])*'/g, "''");

	const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9-]*)[^>]*>/g;
	const selfClosingPattern = /<[a-zA-Z][a-zA-Z0-9-]*[^>]*\/>/g;
	const voidElements = new Set([
		'area',
		'base',
		'br',
		'col',
		'embed',
		'hr',
		'img',
		'input',
		'link',
		'meta',
		'param',
		'source',
		'track',
		'wbr',
	]);

	// Remove self-closing tags
	const contentWithoutSelfClosing = withoutStrings.replace(
		selfClosingPattern,
		'',
	);

	const stack: string[] = [];
	const unclosed: string[] = [];
	const unopened: string[] = [];

	let match;
	while ((match = tagPattern.exec(contentWithoutSelfClosing)) !== null) {
		const isClosing = match[0]?.startsWith('</');
		const tagName = match[1]?.toLowerCase();

		if (!tagName) continue;

		// Skip void elements
		if (!isClosing && voidElements.has(tagName)) {
			continue;
		}

		if (isClosing) {
			const lastOpenTag = stack.pop();
			if (!lastOpenTag || lastOpenTag !== tagName) {
				unopened.push(tagName);
				if (lastOpenTag) stack.push(lastOpenTag); // Put it back
			}
		} else {
			stack.push(tagName);
		}
	}

	unclosed.push(...stack);

	return {
		isValid: unclosed.length === 0 && unopened.length === 0,
		unclosed,
		unopened,
	};
}

/**
 * Check for unclosed strings (basic check)
 */
function checkUnclosedStrings(
	code: string,
	rules: LanguageRules,
): {
	hasUnclosed: boolean;
	type?: 'single' | 'double' | 'template' | 'multiline';
} {
	// Simple heuristic: count quotes on each line
	const lines = code.split('\n');

	for (const line of lines) {
		// Skip if line is a comment
		let isComment = false;
		for (const pattern of rules.singleLineComment) {
			if (pattern.test(line.trim())) {
				isComment = true;
				break;
			}
		}
		if (isComment) continue;

		// Count unescaped quotes
		const doubleQuotes = (line.match(/(?<!\\)"/g) || []).length;
		const singleQuotes = (line.match(/(?<!\\)'/g) || []).length;
		const templateQuotes = rules.hasTemplateStrings
			? (line.match(/(?<!\\)`/g) || []).length
			: 0;

		if (doubleQuotes % 2 !== 0) {
			return {hasUnclosed: true, type: 'double'};
		}
		if (singleQuotes % 2 !== 0) {
			return {hasUnclosed: true, type: 'single'};
		}
		if (templateQuotes % 2 !== 0) {
			return {hasUnclosed: true, type: 'template'};
		}
	}

	return {hasUnclosed: false};
}

/**
 * Validate code boundaries before editing
 * This is the main validation function to be called before any edit operation
 *
 * @param code - Code content to validate
 * @param filePath - Optional file path for language detection
 * @param strictMode - If true, treats warnings as errors
 * @returns Validation result with errors and warnings
 */
export function validateCodeBoundaries(
	code: string,
	filePath?: string,
	strictMode: boolean = true,
): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	// Get language-specific rules
	const rules = getLanguageRules(filePath, code);

	// Step 1: Remove comments
	const withoutComments = removeComments(code, rules);

	// Step 2: Remove strings
	const cleanCode = removeStrings(withoutComments, rules);

	// Step 3: Count brackets
	const brackets = countBrackets(cleanCode);

	// Step 4: Stack-based bracket validation (more accurate)
	const stackValidation = validateBracketStack(cleanCode);

	// Step 5: Validate HTML/XML tags if applicable
	let tagValidation:
		| {isValid: boolean; unclosed: string[]; unopened: string[]}
		| undefined;
	if (rules.validateTags) {
		tagValidation = validateTags(code);
	}

	// Step 6: Check for unclosed strings
	const stringCheck = checkUnclosedStrings(code, rules);

	// Analyze results and build error/warning messages

	// Bracket errors from stack validation (most accurate)
	if (!stackValidation.isValid) {
		errors.push(...stackValidation.errors);
	}
	// Fallback to count-based validation if stack validation passed
	else {
		if (brackets.curly.diff !== 0) {
			const msg =
				brackets.curly.diff > 0
					? `${brackets.curly.diff} unclosed curly bracket(s) '{'`
					: `${Math.abs(
							brackets.curly.diff,
					  )} extra closing curly bracket(s) '}'`;
			errors.push(msg);
		}

		if (brackets.round.diff !== 0) {
			const msg =
				brackets.round.diff > 0
					? `${brackets.round.diff} unclosed parenthesis '('`
					: `${Math.abs(brackets.round.diff)} extra closing parenthesis ')'`;
			errors.push(msg);
		}

		if (brackets.square.diff !== 0) {
			const msg =
				brackets.square.diff > 0
					? `${brackets.square.diff} unclosed square bracket(s) '['`
					: `${Math.abs(
							brackets.square.diff,
					  )} extra closing square bracket(s) ']'`;
			errors.push(msg);
		}
	}

	// Tag validation errors
	if (tagValidation && !tagValidation.isValid) {
		if (tagValidation.unclosed.length > 0) {
			errors.push(
				`Unclosed HTML/XML tag(s): ${tagValidation.unclosed.join(', ')}`,
			);
		}
		if (tagValidation.unopened.length > 0) {
			errors.push(
				`Unopened closing tag(s): ${tagValidation.unopened.join(', ')}`,
			);
		}
	}

	// String validation
	if (stringCheck.hasUnclosed) {
		errors.push(
			`Unclosed ${
				stringCheck.type || 'string'
			} quote detected - this may cause syntax errors`,
		);
	}

	// Angle brackets warning (for generics in languages like TypeScript, Java, C#)
	if (
		brackets.angle.diff !== 0 &&
		filePath?.match(/\.(ts|tsx|java|cs|cpp|hpp)$/)
	) {
		warnings.push(
			`Unbalanced angle brackets '<>' detected (${
				brackets.angle.diff > 0
					? `${brackets.angle.diff} unclosed`
					: `${Math.abs(brackets.angle.diff)} extra`
			}) - may indicate incomplete generic type or comparison operators`,
		);
	}

	return {
		isValid: strictMode
			? errors.length === 0 && warnings.length === 0
			: errors.length === 0,
		errors,
		warnings,
		details: {
			brackets,
			tags: tagValidation
				? {
						unclosed: tagValidation.unclosed,
						unopened: tagValidation.unopened,
				  }
				: undefined,
			strings: stringCheck.hasUnclosed
				? {unclosed: true, type: stringCheck.type}
				: undefined,
		},
	};
}

/**
 * Pre-validate edit operation
 * Validates both searchContent and replaceContent before allowing edit
 *
 * @param searchContent - Content to search for
 * @param replaceContent - Content to replace with
 * @param filePath - Optional file path for language detection
 * @returns Validation result, if not valid, edit should be rejected
 */
export function preValidateEdit(
	searchContent: string,
	replaceContent: string,
	filePath?: string,
): {
	canEdit: boolean;
	reason?: string;
	searchValidation?: ValidationResult;
	replaceValidation?: ValidationResult;
} {
	// Validate search content
	const searchValidation = validateCodeBoundaries(
		searchContent,
		filePath,
		true, // Strict mode for search content
	);

	// Validate replace content
	const replaceValidation = validateCodeBoundaries(
		replaceContent,
		filePath,
		true, // Strict mode for replace content
	);

	// Check if both are valid
	const searchValid = searchValidation.isValid;
	const replaceValid = replaceValidation.isValid;

	if (!searchValid || !replaceValid) {
		const reasons: string[] = [];

		if (!searchValid) {
			reasons.push(`❌ Search content has incomplete code boundaries:`);
			searchValidation.errors.forEach(err => {
				reasons.push(`   • ${err}`);
			});
			if (searchValidation.warnings.length > 0) {
				searchValidation.warnings.forEach(warn => {
					reasons.push(`   ⚠️  ${warn}`);
				});
			}
		}

		if (!replaceValid) {
			reasons.push(`❌ Replace content has incomplete code boundaries:`);
			replaceValidation.errors.forEach(err => {
				reasons.push(`   • ${err}`);
			});
			if (replaceValidation.warnings.length > 0) {
				replaceValidation.warnings.forEach(warn => {
					reasons.push(`   ⚠️  ${warn}`);
				});
			}
		}

		reasons.push('');
		reasons.push('💡 Fix suggestions:');
		reasons.push(
			'   1. Use filesystem-read to identify COMPLETE code boundaries',
		);
		reasons.push(
			'   2. Verify ALL opening brackets/tags have matching closing pairs',
		);
		reasons.push(
			'   3. Count symbols: every { must have }, every ( must have ), every [ must have ], every <tag> must have </tag>',
		);
		reasons.push(
			'   4. Copy COMPLETE functions from opening declaration to final closing brace',
		);
		reasons.push(
			'   5. For HTML/XML/JSX, include COMPLETE tags from <tag> to </tag>',
		);

		return {
			canEdit: false,
			reason: reasons.join('\n'),
			searchValidation,
			replaceValidation,
		};
	}

	return {
		canEdit: true,
		searchValidation,
		replaceValidation,
	};
}
