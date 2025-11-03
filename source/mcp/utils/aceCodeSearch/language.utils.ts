/**
 * Language configuration utilities for ACE Code Search
 */

import type {LanguageConfig} from '../../types/aceCodeSearch.types.js';

/**
 * Language-specific parsers configuration
 */
export const LANGUAGE_CONFIG: Record<string, LanguageConfig> = {
	typescript: {
		extensions: ['.ts', '.tsx', '.mts', '.cts'],
		parser: 'typescript',
		symbolPatterns: {
			function:
				/(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>)|(?:@\w+\s+)*(?:public|private|protected|static)?\s*(?:async)?\s*(\w+)\s*[<(]/,
			class:
				/(?:export\s+)?(?:abstract\s+)?(?:class|interface)\s+(\w+)|(?:export\s+)?type\s+(\w+)\s*=|(?:export\s+)?enum\s+(\w+)|(?:export\s+)?namespace\s+(\w+)/,
			variable:
				/(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::|=)|(?:@\w+\s+)*(?:public|private|protected|readonly|static)?\s+(\w+)\s*[?:]/,
			import:
				/import\s+(?:type\s+)?(?:{[^}]+}|\w+|\*\s+as\s+\w+)\s+from\s+['"]([^'"]+)['"]/,
			export:
				/export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type|enum|namespace|abstract\s+class)\s+(\w+)/,
		},
	},
	javascript: {
		extensions: ['.js', '.jsx', '.mjs', '.cjs', '.es', '.es6'],
		parser: 'javascript',
		symbolPatterns: {
			function:
				/(?:export\s+)?(?:async\s+)?(?:function\s*\*?\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function\s*\*?\s*)?(?:\([^)]*\)\s*=>|\([^)]*\)\s*\{))|(\w+)\s*\([^)]*\)\s*\{/,
			class: /(?:export\s+)?class\s+(\w+)/,
			variable: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/,
			import:
				/import\s+(?:{[^}]+}|\w+|\*\s+as\s+\w+)\s+from\s+['"]([^'"]+)['"]/,
			export:
				/export\s+(?:default\s+)?(?:class|function|const|let|var)\s+(\w+)/,
		},
	},
	python: {
		extensions: ['.py', '.pyx', '.pyi', '.pyw', '.pyz'],
		parser: 'python',
		symbolPatterns: {
			function: /(?:@\w+\s+)*(?:async\s+)?def\s+(\w+)\s*\(/,
			class: /(?:@\w+\s+)*class\s+(\w+)\s*[(:]/,
			variable:
				/^(?:[\t ]*)([\w_][\w\d_]*)\s*(?::.*)?=\s*(?![=\s])|^([\w_][\w\d_]*)\s*:\s*(?!.*=)/m,
			import:
				/(?:from\s+([\w.]+)\s+import\s+[\w, *]+|import\s+([\w.]+(?:\s+as\s+\w+)?))/,
			export: /^(?:__all__\s*=|def\s+(\w+)|class\s+(\w+))/, // Python exports via __all__ or top-level
		},
	},
	go: {
		extensions: ['.go'],
		parser: 'go',
		symbolPatterns: {
			function: /func\s+(?:\([^)]+\)\s+)?(\w+)\s*[<(]/,
			class: /type\s+(\w+)\s+(?:struct|interface)/,
			variable: /(?:var|const)\s+(\w+)\s+[\w\[\]*{]|(?:var|const)\s+\(\s*(\w+)/,
			import: /import\s+(?:"([^"]+)"|_\s+"([^"]+)"|\w+\s+"([^"]+)")/,
			export:
				/^(?:func|type|var|const)\s+([A-Z]\w+)|^type\s+([A-Z]\w+)\s+(?:struct|interface)/, // Go exports start with capital letter
		},
	},
	rust: {
		extensions: ['.rs'],
		parser: 'rust',
		symbolPatterns: {
			function:
				/(?:pub(?:\s*\([^)]+\))?\s+)?(?:unsafe\s+)?(?:async\s+)?(?:const\s+)?(?:extern\s+(?:"[^"]+"\s+)?)?fn\s+(\w+)\s*[<(]/,
			class:
				/(?:pub(?:\s*\([^)]+\))?\s+)?(?:struct|enum|trait|union|type)\s+(\w+)|impl(?:\s+<[^>]+>)?\s+(?:\w+::)*(\w+)/,
			variable:
				/(?:pub(?:\s*\([^)]+\))?\s+)?(?:static|const|mut)?\s*(?:let\s+(?:mut\s+)?)?(\w+)\s*[:=]/,
			import: /use\s+([^;]+);|extern\s+crate\s+(\w+);/,
			export:
				/pub(?:\s*\([^)]+\))?\s+(?:fn|struct|enum|trait|const|static|type|mod|use)\s+(\w+)/,
		},
	},
	java: {
		extensions: ['.java'],
		parser: 'java',
		symbolPatterns: {
			function:
				/(?:@\w+\s+)*(?:public|private|protected|static|final|synchronized|native|abstract|\s)+[\w<>\[\]]+\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*[{;]/,
			class:
				/(?:@\w+\s+)*(?:public|private|protected)?\s*(?:abstract|final|static)?\s*(?:class|interface|enum|record|@interface)\s+(\w+)/,
			variable:
				/(?:@\w+\s+)*(?:public|private|protected|static|final|transient|volatile|\s)+[\w<>\[\]]+\s+(\w+)\s*[=;]/,
			import: /import\s+(?:static\s+)?([\w.*]+);/,
			export: /public\s+(?:class|interface|enum|record|@interface)\s+(\w+)/,
		},
	},
	csharp: {
		extensions: ['.cs'],
		parser: 'csharp',
		symbolPatterns: {
			function:
				/(?:\[[\w\s,()]+\]\s+)*(?:public|private|protected|internal|static|virtual|override|abstract|async|\s)+[\w<>\[\]?]+\s+(\w+)\s*[<(]/,
			class:
				/(?:\[[\w\s,()]+\]\s+)*(?:public|private|protected|internal)?\s*(?:abstract|sealed|static|partial)?\s*(?:class|interface|struct|record|enum)\s+(\w+)/,
			variable:
				/(?:\[[\w\s,()]+\]\s+)*(?:public|private|protected|internal|static|readonly|const|volatile|\s)+[\w<>\[\]?]+\s+(\w+)\s*[{=;]|(?:public|private|protected|internal)?\s*[\w<>\[\]?]+\s+(\w+)\s*\{\s*get/,
			import: /using\s+(?:static\s+)?([\w.]+);/,
			export:
				/public\s+(?:class|interface|enum|struct|record|delegate)\s+(\w+)/,
		},
	},
	c: {
		extensions: ['.c', '.h'],
		parser: 'c',
		symbolPatterns: {
			function:
				/(?:static|extern|inline)?\s*[\w\s\*]+\s+(\w+)\s*\([^)]*\)\s*\{/,
			class: /(?:struct|union|enum)\s+(\w+)\s*\{/,
			variable: /(?:extern|static|const)?\s*[\w\s\*]+\s+(\w+)\s*[=;]/,
			import: /#include\s+[<"]([^>"]+)[>"]/,
			export: /^[\w\s\*]+\s+(\w+)\s*\([^)]*\)\s*;/, // Function declarations
		},
	},
	cpp: {
		extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx', '.h++', '.c++'],
		parser: 'cpp',
		symbolPatterns: {
			function:
				/(?:static|extern|inline|virtual|explicit|constexpr)?\s*[\w\s\*&:<>,]+\s+(\w+)\s*\([^)]*\)\s*(?:const)?\s*(?:override)?\s*\{/,
			class:
				/(?:class|struct|union|enum\s+class|enum\s+struct)\s+(\w+)(?:\s*:\s*(?:public|private|protected)\s+[\w,\s<>]+)?\s*\{/,
			variable:
				/(?:extern|static|const|constexpr|inline)?\s*[\w\s\*&:<>,]+\s+(\w+)\s*[=;]/,
			import: /#include\s+[<"]([^>"]+)[>"]/,
			export: /^[\w\s\*&:<>,]+\s+(\w+)\s*\([^)]*\)\s*;/,
		},
	},
	php: {
		extensions: ['.php', '.phtml', '.php3', '.php4', '.php5', '.phps'],
		parser: 'php',
		symbolPatterns: {
			function: /(?:public|private|protected|static)?\s*function\s+(\w+)\s*\(/,
			class:
				/(?:abstract|final)?\s*class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{/,
			variable: /(?:public|private|protected|static)?\s*\$(\w+)\s*[=;]/,
			import:
				/(?:require|require_once|include|include_once)\s*[('"]([^'"]+)['"]/,
			export: /^(?:public\s+)?(?:function|class|interface|trait)\s+(\w+)/,
		},
	},
	ruby: {
		extensions: ['.rb', '.rake', '.gemspec', '.ru', '.rbw'],
		parser: 'ruby',
		symbolPatterns: {
			function: /def\s+(?:self\.)?(\w+)/,
			class: /class\s+(\w+)(?:\s+<\s+[\w:]+)?/,
			variable: /(?:@|@@|\$)?(\w+)\s*=(?!=)/,
			import: /require(?:_relative)?\s+['"]([^'"]+)['"]/,
			export: /module_function\s+:(\w+)|^def\s+(\w+)/, // Ruby's module exports
		},
	},
	swift: {
		extensions: ['.swift'],
		parser: 'swift',
		symbolPatterns: {
			function:
				/(?:public|private|internal|fileprivate|open)?\s*(?:static|class)?\s*func\s+(\w+)\s*[<(]/,
			class:
				/(?:public|private|internal|fileprivate|open)?\s*(?:final)?\s*(?:class|struct|enum|protocol|actor)\s+(\w+)/,
			variable:
				/(?:public|private|internal|fileprivate|open)?\s*(?:static|class)?\s*(?:let|var)\s+(\w+)\s*[:=]/,
			import: /import\s+(?:class|struct|enum|protocol)?\s*([\w.]+)/,
			export: /public\s+(?:func|class|struct|enum|protocol|var|let)\s+(\w+)/,
		},
	},
	kotlin: {
		extensions: ['.kt', '.kts'],
		parser: 'kotlin',
		symbolPatterns: {
			function:
				/(?:public|private|protected|internal)?\s*(?:suspend|inline|infix|operator)?\s*fun\s+(\w+)\s*[<(]/,
			class:
				/(?:public|private|protected|internal)?\s*(?:abstract|open|final|sealed|data|inline|value)?\s*(?:class|interface|object|enum\s+class)\s+(\w+)/,
			variable:
				/(?:public|private|protected|internal)?\s*(?:const)?\s*(?:val|var)\s+(\w+)\s*[:=]/,
			import: /import\s+([\w.]+)/,
			export: /^(?:public\s+)?(?:fun|class|interface|object|val|var)\s+(\w+)/,
		},
	},
	dart: {
		extensions: ['.dart'],
		parser: 'dart',
		symbolPatterns: {
			function:
				/(?:static|abstract|external)?\s*[\w<>?,\s]+\s+(\w+)\s*\([^)]*\)\s*(?:async|sync\*)?\s*\{/,
			class:
				/(?:abstract)?\s*class\s+(\w+)(?:\s+extends\s+[\w<>]+)?(?:\s+with\s+[\w,\s<>]+)?(?:\s+implements\s+[\w,\s<>]+)?\s*\{/,
			variable:
				/(?:static|final|const|late)?\s*(?:var|[\w<>?,\s]+)\s+(\w+)\s*[=;]/,
			import: /import\s+['"]([^'"]+)['"]/,
			export: /^(?:class|abstract\s+class|enum|mixin)\s+(\w+)/,
		},
	},
	shell: {
		extensions: ['.sh', '.bash', '.zsh', '.ksh', '.fish'],
		parser: 'shell',
		symbolPatterns: {
			function: /(?:function\s+)?(\w+)\s*\(\s*\)\s*\{/,
			class: /^$/, // Shell doesn't have classes
			variable: /(?:export\s+)?(\w+)=/,
			import: /(?:source|\.)\s+([^\s;]+)/,
			export: /export\s+(?:function\s+)?(\w+)/,
		},
	},
	scala: {
		extensions: ['.scala', '.sc'],
		parser: 'scala',
		symbolPatterns: {
			function: /def\s+(\w+)\s*[:\[(]/,
			class:
				/(?:sealed|abstract|final|implicit)?\s*(?:class|trait|object|case\s+class|case\s+object)\s+(\w+)/,
			variable: /(?:val|var|lazy\s+val)\s+(\w+)\s*[:=]/,
			import: /import\s+([\w.{},\s=>]+)/,
			export: /^(?:object|class|trait)\s+(\w+)/,
		},
	},
	r: {
		extensions: ['.r', '.R', '.rmd', '.Rmd'],
		parser: 'r',
		symbolPatterns: {
			function: /(\w+)\s*<-\s*function\s*\(|^(\w+)\s*=\s*function\s*\(/,
			class: /setClass\s*\(\s*['"](\w+)['"]/,
			variable: /(\w+)\s*(?:<-|=)\s*(?!function)/,
			import: /(?:library|require)\s*\(\s*['"]?(\w+)['"]?\s*\)/,
			export: /^(\w+)\s*<-\s*function/, // R exports at top level
		},
	},
	lua: {
		extensions: ['.lua'],
		parser: 'lua',
		symbolPatterns: {
			function: /(?:local\s+)?function\s+(?:[\w.]+[.:])?(\w+)\s*\(/,
			class: /(\w+)\s*=\s*\{\s*\}|(\w+)\s*=\s*class\s*\(/,
			variable: /(?:local\s+)?(\w+)\s*=/,
			import: /require\s*\(?['"]([^'"]+)['"]\)?/,
			export: /return\s+(\w+)|module\s*\(\s*['"]([^'"]+)['"]/,
		},
	},
	perl: {
		extensions: ['.pl', '.pm', '.t', '.pod'],
		parser: 'perl',
		symbolPatterns: {
			function: /sub\s+(\w+)\s*\{/,
			class: /package\s+([\w:]+)\s*;/,
			variable: /(?:my|our|local)\s*[\$@%](\w+)\s*=/,
			import: /(?:use|require)\s+([\w:]+)/,
			export: /^sub\s+(\w+)|our\s+[\$@%](\w+)/,
		},
	},
	objectivec: {
		extensions: ['.m', '.mm', '.h'],
		parser: 'objectivec',
		symbolPatterns: {
			function: /[-+]\s*\([^)]+\)\s*(\w+)(?::|;|\s*\{)/,
			class: /@(?:interface|implementation|protocol)\s+(\w+)/,
			variable: /@property\s+[^;]+\s+(\w+);|^[\w\s\*]+\s+(\w+)\s*[=;]/,
			import: /#import\s+[<"]([^>"]+)[>"]/,
			export: /@interface\s+(\w+)|@protocol\s+(\w+)/,
		},
	},
	haskell: {
		extensions: ['.hs', '.lhs'],
		parser: 'haskell',
		symbolPatterns: {
			function: /^(\w+)\s*::/,
			class: /(?:class|instance)\s+(\w+)/,
			variable: /^(\w+)\s*=/,
			import: /import\s+(?:qualified\s+)?([\w.]+)/,
			export: /module\s+[\w.]+\s*\(([^)]+)\)/,
		},
	},
	elixir: {
		extensions: ['.ex', '.exs'],
		parser: 'elixir',
		symbolPatterns: {
			function: /def(?:p|macro|macrop)?\s+(\w+)(?:\(|,|\s+do)/,
			class: /defmodule\s+([\w.]+)\s+do/,
			variable: /@(\w+)\s+|(\w+)\s*=\s*(?!fn)/,
			import: /(?:import|alias|require|use)\s+([\w.]+)/,
			export: /^def\s+(\w+)/,
		},
	},
	clojure: {
		extensions: ['.clj', '.cljs', '.cljc', '.edn'],
		parser: 'clojure',
		symbolPatterns: {
			function: /\(defn-?\s+(\w+)/,
			class: /\(defrecord\s+(\w+)|\(deftype\s+(\w+)|\(defprotocol\s+(\w+)/,
			variable: /\(def\s+(\w+)/,
			import: /\(:require\s+\[([^\]]+)\]/,
			export: /\(defn-?\s+(\w+)/,
		},
	},
	fsharp: {
		extensions: ['.fs', '.fsx', '.fsi'],
		parser: 'fsharp',
		symbolPatterns: {
			function: /let\s+(?:rec\s+)?(\w+)(?:\s+\w+)*\s*=/,
			class: /type\s+(\w+)\s*(?:=|<|\()/,
			variable: /let\s+(?:mutable\s+)?(\w+)\s*=/,
			import: /open\s+([\w.]+)/,
			export: /^(?:let|type)\s+(\w+)/,
		},
	},
	vbnet: {
		extensions: ['.vb', '.vbs'],
		parser: 'vbnet',
		symbolPatterns: {
			function:
				/(?:Public|Private|Protected|Friend)?\s*(?:Shared)?\s*(?:Function|Sub)\s+(\w+)/i,
			class:
				/(?:Public|Private|Protected|Friend)?\s*(?:MustInherit|NotInheritable)?\s*Class\s+(\w+)/i,
			variable:
				/(?:Public|Private|Protected|Friend|Dim|Const)?\s*(\w+)\s+As\s+/i,
			import: /Imports\s+([\w.]+)/i,
			export: /Public\s+(?:Class|Module|Function|Sub)\s+(\w+)/i,
		},
	},
	matlab: {
		extensions: ['.m', '.mlx'],
		parser: 'matlab',
		symbolPatterns: {
			function: /function\s+(?:\[[^\]]+\]\s*=\s*|[\w,\s]+\s*=\s*)?(\w+)\s*\(/,
			class: /classdef\s+(\w+)/,
			variable: /(\w+)\s*=\s*(?!function)/,
			import: /import\s+([\w.*]+)/,
			export: /^function\s+(?:\[[^\]]+\]\s*=\s*)?(\w+)/,
		},
	},
	sql: {
		extensions: ['.sql', '.ddl', '.dml'],
		parser: 'sql',
		symbolPatterns: {
			function: /CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+(\w+)/i,
			class: /CREATE\s+(?:TABLE|VIEW)\s+(\w+)/i,
			variable: /DECLARE\s+@?(\w+)/i,
			import: /^$/, // SQL doesn't have imports
			export: /^CREATE\s+(?:FUNCTION|PROCEDURE|VIEW)\s+(\w+)/i,
		},
	},
	html: {
		extensions: ['.html', '.htm', '.xhtml'],
		parser: 'html',
		symbolPatterns: {
			function: /<script[^>]*>[\s\S]*?function\s+(\w+)/,
			class: /class\s*=\s*["']([^"']+)["']/,
			variable: /id\s*=\s*["']([^"']+)["']/,
			import: /<(?:link|script)[^>]+(?:href|src)\s*=\s*["']([^"']+)["']/,
			export:
				/<(?:div|section|article|header|footer)[^>]+id\s*=\s*["']([^"']+)["']/,
		},
	},
	css: {
		extensions: ['.css', '.scss', '.sass', '.less', '.styl'],
		parser: 'css',
		symbolPatterns: {
			function: /@mixin\s+(\w+)|@function\s+(\w+)/,
			class: /\.(\w+(?:-\w+)*)\s*\{/,
			variable: /--(\w+(?:-\w+)*):|@(\w+):|(\$\w+):/,
			import: /@import\s+(?:url\()?['"]([^'"]+)['"]/,
			export: /@mixin\s+(\w+)|@function\s+(\w+)/,
		},
	},
	vue: {
		extensions: ['.vue'],
		parser: 'vue',
		symbolPatterns: {
			function:
				/<script[^>]*>[\s\S]*?(?:export\s+default\s*\{[\s\S]*?)?(?:function|const|let|var)\s+(\w+)|methods\s*:\s*\{[\s\S]*?(\w+)\s*\(/,
			class: /<template[^>]*>[\s\S]*?<(\w+)/,
			variable:
				/<script[^>]*>[\s\S]*?(?:data\s*\(\s*\)\s*\{[\s\S]*?return\s*\{[\s\S]*?(\w+)|(?:const|let|var)\s+(\w+)\s*=)/,
			import:
				/<script[^>]*>[\s\S]*?import\s+(?:{[^}]+}|\w+)\s+from\s+['"]([^'"]+)['"]/,
			export: /<script[^>]*>[\s\S]*?export\s+default/,
		},
	},
	svelte: {
		extensions: ['.svelte'],
		parser: 'svelte',
		symbolPatterns: {
			function:
				/<script[^>]*>[\s\S]*?(?:function|const|let|var)\s+(\w+)\s*[=(]/,
			class: /<[\w-]+/,
			variable: /<script[^>]*>[\s\S]*?(?:let|const|var)\s+(\w+)\s*=/,
			import:
				/<script[^>]*>[\s\S]*?import\s+(?:{[^}]+}|\w+)\s+from\s+['"]([^'"]+)['"]/,
			export: /<script[^>]*>[\s\S]*?export\s+(?:let|const|function)\s+(\w+)/,
		},
	},
	xml: {
		extensions: ['.xml', '.xsd', '.xsl', '.xslt', '.svg'],
		parser: 'xml',
		symbolPatterns: {
			function: /<xsl:template[^>]+name\s*=\s*["']([^"']+)["']/,
			class:
				/<(?:xsd:)?(?:complexType|simpleType)[^>]+name\s*=\s*["']([^"']+)["']/,
			variable: /<(?:xsd:)?element[^>]+name\s*=\s*["']([^"']+)["']/,
			import: /<(?:xsd:)?import[^>]+schemaLocation\s*=\s*["']([^"']+)["']/,
			export: /<(?:xsd:)?element[^>]+name\s*=\s*["']([^"']+)["']/,
		},
	},
	yaml: {
		extensions: ['.yaml', '.yml'],
		parser: 'yaml',
		symbolPatterns: {
			function: /^(\w+):\s*\|/m,
			class: /^(\w+):$/m,
			variable: /^(\w+):\s*[^|>]/m,
			import: /^$/, // YAML doesn't have imports
			export: /^(\w+):$/m,
		},
	},
	json: {
		extensions: ['.json', '.jsonc', '.json5'],
		parser: 'json',
		symbolPatterns: {
			function: /^$/,
			class: /^$/,
			variable: /"(\w+)"\s*:/,
			import: /^$/,
			export: /^$/,
		},
	},
	toml: {
		extensions: ['.toml'],
		parser: 'toml',
		symbolPatterns: {
			function: /^$/,
			class: /^\[(\w+(?:\.\w+)*)\]/,
			variable: /^(\w+)\s*=/,
			import: /^$/,
			export: /^\[(\w+(?:\.\w+)*)\]/,
		},
	},
	markdown: {
		extensions: ['.md', '.markdown', '.mdown', '.mkd'],
		parser: 'markdown',
		symbolPatterns: {
			function: /```[\w]*\n[\s\S]*?function\s+(\w+)/,
			class: /^#{1,6}\s+(.+)$/m,
			variable: /\[([^\]]+)\]:/,
			import: /\[([^\]]+)\]\(([^)]+)\)/,
			export: /^#{1,6}\s+(.+)$/m,
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
