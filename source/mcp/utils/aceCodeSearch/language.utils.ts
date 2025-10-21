/**
 * Language configuration utilities for ACE Code Search
 */

import type {LanguageConfig} from '../../types/aceCodeSearch.types.js';

/**
 * Language-specific parsers configuration
 */
export const LANGUAGE_CONFIG: Record<string, LanguageConfig> = {
	typescript: {
		extensions: ['.ts', '.tsx'],
		parser: 'typescript',
		symbolPatterns: {
			function:
				/(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/,
			class: /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/,
			variable: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/,
			import: /import\s+(?:{[^}]+}|\w+)\s+from\s+['"]([^'"]+)['"]/,
			export:
				/export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type|enum)\s+(\w+)/,
		},
	},
	javascript: {
		extensions: ['.js', '.jsx', '.mjs', '.cjs'],
		parser: 'javascript',
		symbolPatterns: {
			function:
				/(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/,
			class: /(?:export\s+)?class\s+(\w+)/,
			variable: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/,
			import: /import\s+(?:{[^}]+}|\w+)\s+from\s+['"]([^'"]+)['"]/,
			export:
				/export\s+(?:default\s+)?(?:class|function|const|let|var)\s+(\w+)/,
		},
	},
	python: {
		extensions: ['.py', '.pyx', '.pyi'],
		parser: 'python',
		symbolPatterns: {
			function: /def\s+(\w+)\s*\(/,
			class: /class\s+(\w+)\s*[(:]/,
			variable: /(\w+)\s*=\s*[^=]/,
			import: /(?:from\s+[\w.]+\s+)?import\s+([\w, ]+)/,
			export: /^(\w+)\s*=\s*/, // Python doesn't have explicit exports
		},
	},
	go: {
		extensions: ['.go'],
		parser: 'go',
		symbolPatterns: {
			function: /func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/,
			class: /type\s+(\w+)\s+struct/,
			variable: /(?:var|const)\s+(\w+)\s+/,
			import: /import\s+(?:"([^"]+)"|[(]([^)]+)[)])/,
			export: /^(?:func|type|var|const)\s+([A-Z]\w+)/, // Go exports start with capital letter
		},
	},
	rust: {
		extensions: ['.rs'],
		parser: 'rust',
		symbolPatterns: {
			function: /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*[<(]/,
			class:
				/(?:pub\s+)?struct\s+(\w+)|(?:pub\s+)?enum\s+(\w+)|(?:pub\s+)?trait\s+(\w+)/,
			variable: /(?:pub\s+)?(?:static|const)\s+(\w+)\s*:/,
			import: /use\s+([^;]+);/,
			export: /pub\s+(?:fn|struct|enum|trait|const|static)\s+(\w+)/,
		},
	},
	java: {
		extensions: ['.java'],
		parser: 'java',
		symbolPatterns: {
			function:
				/(?:public|private|protected|static|\s)+[\w<>\[\]]+\s+(\w+)\s*\([^)]*\)\s*\{/,
			class:
				/(?:public|private|protected)?\s*(?:abstract|final)?\s*class\s+(\w+)/,
			variable:
				/(?:public|private|protected|static|final|\s)+[\w<>\[\]]+\s+(\w+)\s*[=;]/,
			import: /import\s+([\w.]+);/,
			export: /public\s+(?:class|interface|enum)\s+(\w+)/,
		},
	},
	csharp: {
		extensions: ['.cs'],
		parser: 'csharp',
		symbolPatterns: {
			function:
				/(?:public|private|protected|internal|static|\s)+[\w<>\[\]]+\s+(\w+)\s*\([^)]*\)\s*\{/,
			class:
				/(?:public|private|protected|internal)?\s*(?:abstract|sealed|static)?\s*class\s+(\w+)/,
			variable:
				/(?:public|private|protected|internal|static|readonly|\s)+[\w<>\[\]]+\s+(\w+)\s*[=;]/,
			import: /using\s+([\w.]+);/,
			export: /public\s+(?:class|interface|enum|struct)\s+(\w+)/,
		},
	},
};

/**
 * Detect programming language from file extension
 * @param filePath - File path to detect language from
 * @returns Language name or null if not supported
 */
export function detectLanguage(filePath: string): string | null {
	const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
	for (const [lang, config] of Object.entries(LANGUAGE_CONFIG)) {
		if (config.extensions.includes(ext)) {
			return lang;
		}
	}
	return null;
}
