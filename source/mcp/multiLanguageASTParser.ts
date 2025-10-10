import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import TypeScript from 'tree-sitter-typescript';
import Python from 'tree-sitter-python';
import Java from 'tree-sitter-java';
import Go from 'tree-sitter-go';
import Cpp from 'tree-sitter-cpp';
import C from 'tree-sitter-c';
import CSharp from 'tree-sitter-c-sharp';
import Rust from 'tree-sitter-rust';
import Ruby from 'tree-sitter-ruby';
import PHP from 'tree-sitter-php';

/**
 * Supported programming languages for AST parsing
 */
export type SupportedLanguage =
	| 'javascript'
	| 'typescript'
	| 'tsx'
	| 'python'
	| 'java'
	| 'go'
	| 'cpp'
	| 'c'
	| 'csharp'
	| 'rust'
	| 'ruby'
	| 'php';

/**
 * AST node result with metadata
 */
export interface ASTNodeResult {
	name: string;
	type: string;
	startPosition: {line: number; column: number};
	endPosition: {line: number; column: number};
	text: string;
	language: SupportedLanguage;
}

/**
 * Language configuration mapping file extensions to parsers
 */
interface LanguageConfig {
	extensions: string[];
	parser: any;
	nodeTypes: string[];
}

/**
 * Multi-language AST parser using tree-sitter
 * Supports JavaScript, TypeScript, Python, Java, Go, C/C++, C#, Rust, Ruby, PHP
 */
export class MultiLanguageASTParser {
	private parsers: Map<SupportedLanguage, Parser> = new Map();
	private languageConfigs: Map<SupportedLanguage, LanguageConfig> = new Map();

	constructor() {
		this.initializeLanguageConfigs();
		this.initializeParsers();
	}

	/**
	 * Initialize language configurations
	 */
	private initializeLanguageConfigs(): void {
		// JavaScript
		this.languageConfigs.set('javascript', {
			extensions: ['.js', '.jsx', '.mjs', '.cjs'],
			parser: JavaScript,
			nodeTypes: [
				'function_declaration',
				'arrow_function',
				'function_expression',
				'class_declaration',
				'method_definition',
				'variable_declarator',
				'lexical_declaration',
			],
		});

		// TypeScript
		this.languageConfigs.set('typescript', {
			extensions: ['.ts'],
			parser: TypeScript.typescript,
			nodeTypes: [
				'function_declaration',
				'arrow_function',
				'function_expression',
				'class_declaration',
				'method_definition',
				'interface_declaration',
				'type_alias_declaration',
				'enum_declaration',
				'variable_declarator',
				'lexical_declaration',
			],
		});

		// TSX
		this.languageConfigs.set('tsx', {
			extensions: ['.tsx'],
			parser: TypeScript.tsx,
			nodeTypes: [
				'function_declaration',
				'arrow_function',
				'function_expression',
				'class_declaration',
				'method_definition',
				'interface_declaration',
				'type_alias_declaration',
				'enum_declaration',
				'variable_declarator',
				'lexical_declaration',
			],
		});

		// Python
		this.languageConfigs.set('python', {
			extensions: ['.py', '.pyw'],
			parser: Python,
			nodeTypes: [
				'function_definition',
				'class_definition',
				'decorated_definition',
				'assignment',
			],
		});

		// Java
		this.languageConfigs.set('java', {
			extensions: ['.java'],
			parser: Java,
			nodeTypes: [
				'method_declaration',
				'class_declaration',
				'interface_declaration',
				'enum_declaration',
				'constructor_declaration',
				'field_declaration',
			],
		});

		// Go
		this.languageConfigs.set('go', {
			extensions: ['.go'],
			parser: Go,
			nodeTypes: [
				'function_declaration',
				'method_declaration',
				'type_declaration',
				'type_spec',
				'var_declaration',
				'const_declaration',
			],
		});

		// C++
		this.languageConfigs.set('cpp', {
			extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hxx', '.h'],
			parser: Cpp,
			nodeTypes: [
				'function_definition',
				'function_declarator',
				'class_specifier',
				'struct_specifier',
				'enum_specifier',
				'namespace_definition',
				'declaration',
			],
		});

		// C
		this.languageConfigs.set('c', {
			extensions: ['.c', '.h'],
			parser: C,
			nodeTypes: [
				'function_definition',
				'function_declarator',
				'struct_specifier',
				'enum_specifier',
				'declaration',
			],
		});

		// C#
		this.languageConfigs.set('csharp', {
			extensions: ['.cs'],
			parser: CSharp,
			nodeTypes: [
				'method_declaration',
				'class_declaration',
				'interface_declaration',
				'struct_declaration',
				'enum_declaration',
				'property_declaration',
				'field_declaration',
				'constructor_declaration',
			],
		});

		// Rust
		this.languageConfigs.set('rust', {
			extensions: ['.rs'],
			parser: Rust,
			nodeTypes: [
				'function_item',
				'struct_item',
				'enum_item',
				'trait_item',
				'impl_item',
				'mod_item',
				'const_item',
				'static_item',
			],
		});

		// Ruby
		this.languageConfigs.set('ruby', {
			extensions: ['.rb'],
			parser: Ruby,
			nodeTypes: [
				'method',
				'singleton_method',
				'class',
				'module',
				'assignment',
			],
		});

		// PHP
		this.languageConfigs.set('php', {
			extensions: ['.php'],
			parser: PHP.php,
			nodeTypes: [
				'function_definition',
				'method_declaration',
				'class_declaration',
				'interface_declaration',
				'trait_declaration',
				'property_declaration',
			],
		});
	}

	/**
	 * Initialize parsers for all supported languages
	 */
	private initializeParsers(): void {
		for (const [language, config] of this.languageConfigs.entries()) {
			try {
				const parser = new Parser();
				parser.setLanguage(config.parser);
				this.parsers.set(language, parser);
			} catch (error) {
				console.error(
					`Failed to initialize parser for ${language}:`,
					error instanceof Error ? error.message : 'Unknown error',
				);
			}
		}
	}

	/**
	 * Detect language from file extension
	 */
	public detectLanguage(filePath: string): SupportedLanguage | null {
		const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();

		for (const [language, config] of this.languageConfigs.entries()) {
			if (config.extensions.includes(ext)) {
				return language;
			}
		}

		return null;
	}

	/**
	 * Parse source code and search for nodes matching the query
	 */
	public searchAST(
		sourceCode: string,
		filePath: string,
		query: string,
		caseSensitive: boolean = false,
	): ASTNodeResult[] {
		const language = this.detectLanguage(filePath);
		if (!language) {
			return [];
		}

		const parser = this.parsers.get(language);
		if (!parser) {
			return [];
		}

		try {
			const tree = parser.parse(sourceCode);
			const results: ASTNodeResult[] = [];
			const searchQuery = caseSensitive ? query : query.toLowerCase();

			// Traverse the AST
			const traverse = (node: Parser.SyntaxNode) => {
				const nodeType = node.type;
				const config = this.languageConfigs.get(language);

				// Check if this is a node type we're interested in
				if (config && config.nodeTypes.includes(nodeType)) {
					const nodeName = this.extractNodeName(node, language);

					if (nodeName) {
						const nameToCheck = caseSensitive
							? nodeName
							: nodeName.toLowerCase();

						if (nameToCheck.includes(searchQuery)) {
							results.push({
								name: nodeName,
								type: nodeType,
								startPosition: {
									line: node.startPosition.row + 1,
									column: node.startPosition.column + 1,
								},
								endPosition: {
									line: node.endPosition.row + 1,
									column: node.endPosition.column + 1,
								},
								text: node.text,
								language,
							});
						}
					}
				}

				// Recursively traverse children
				for (let i = 0; i < node.childCount; i++) {
					const child = node.child(i);
					if (child) {
						traverse(child);
					}
				}
			};

			traverse(tree.rootNode);
			return results;
		} catch (error) {
			console.error(
				`AST parsing error for ${filePath}:`,
				error instanceof Error ? error.message : 'Unknown error',
			);
			return [];
		}
	}

	/**
	 * Extract the name/identifier from an AST node based on language
	 */
	private extractNodeName(
		node: Parser.SyntaxNode,
		_language: SupportedLanguage,
	): string | null {
		// Common patterns for extracting names from different node types
		const nameFields = ['name', 'identifier', 'declarator', 'property'];

		for (const field of nameFields) {
			const nameNode = node.childForFieldName(field);
			if (nameNode) {
				// For some languages, we need to go deeper
				if (nameNode.type === 'identifier') {
					return nameNode.text;
				}

				// Try to find identifier in children
				const identifierChild = this.findIdentifier(nameNode);
				if (identifierChild) {
					return identifierChild.text;
				}
			}
		}

		// Fallback: try to find any identifier child
		const identifier = this.findIdentifier(node);
		return identifier ? identifier.text : null;
	}

	/**
	 * Recursively find the first identifier node
	 */
	private findIdentifier(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
		if (node.type === 'identifier') {
			return node;
		}

		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i);
			if (child) {
				const identifier = this.findIdentifier(child);
				if (identifier) {
					return identifier;
				}
			}
		}

		return null;
	}

	/**
	 * Get supported file extensions
	 */
	public getSupportedExtensions(): string[] {
		const extensions: string[] = [];
		for (const config of this.languageConfigs.values()) {
			extensions.push(...config.extensions);
		}
		return [...new Set(extensions)];
	}

	/**
	 * Check if a file is supported for AST parsing
	 */
	public isSupported(filePath: string): boolean {
		return this.detectLanguage(filePath) !== null;
	}

	/**
	 * Get node types for a specific language
	 */
	public getNodeTypes(language: SupportedLanguage): string[] {
		const config = this.languageConfigs.get(language);
		return config ? config.nodeTypes : [];
	}
}

// Export singleton instance
export const multiLanguageASTParser = new MultiLanguageASTParser();
