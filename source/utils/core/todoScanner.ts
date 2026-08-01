import fs from 'fs';
import path from 'path';

export interface TodoItem {
	id: string;
	file: string;
	line: number;
	content: string;
	fullLine: string;
}

const IGNORED_PATH_SEGMENTS = new Set([
	'node_modules',
	'.git',
	'dist',
	'build',
	'coverage',
	'.next',
	'.nuxt',
	'.output',
	'out',
	'.DS_Store',
	'yarn.lock',
	'package-lock.json',
	'pnpm-lock.yaml',
]);

const IGNORED_FILE_SUFFIXES = ['.log', '.lock'];

// Common task markers - support various formats
// Only include markers that clearly indicate actionable tasks
const TODO_PATTERNS = [
	// Single-line comments with markers (// TODO, // FIXME, etc.)
	/\/\/\s*(?:TODO|FIXME|HACK|XXX|BUG):?\s*(.+)/i,

	// Block comments (/* TODO */)
	/\/\*\s*(?:TODO|FIXME|HACK|XXX|BUG):?\s*(.+?)\s*\*\//i,

	// Hash comments (# TODO) for Python, Ruby, Shell, etc.
	/#\s*(?:TODO|FIXME|HACK|XXX|BUG):?\s*(.+)/i,

	// HTML/XML comments (<!-- TODO -->)
	/<!--\s*(?:TODO|FIXME|HACK|XXX|BUG):?\s*(.+?)\s*-->/i,

	// JSDoc/PHPDoc style (@todo)
	/\/\*\*?\s*@(?:todo|fixme):?\s*(.+?)(?:\s*\*\/|\n)/i,

	// TODO with brackets/parentheses (common format for task assignment)
	/\/\/\s*TODO\s*[\(\[\{]\s*(.+?)\s*[\)\]\}]/i,
	/#\s*TODO\s*[\(\[\{]\s*(.+?)\s*[\)\]\}]/i,
];

function shouldIgnore(filePath: string): boolean {
	// Match complete path components so names such as `builder` and `.github`
	// are not accidentally treated as the ignored `build` and `.git` folders.
	const segments = filePath.split(path.sep);
	const basename = segments.at(-1) ?? '';
	return (
		segments.some(segment => IGNORED_PATH_SEGMENTS.has(segment)) ||
		IGNORED_FILE_SUFFIXES.some(suffix => basename.endsWith(suffix))
	);
}

function scanFileForTodos(filePath: string, rootDir: string): TodoItem[] {
	try {
		const content = fs.readFileSync(filePath, 'utf-8');
		const lines = content.split('\n');
		const todos: TodoItem[] = [];

		lines.forEach((line, index) => {
			for (const pattern of TODO_PATTERNS) {
				const match = line.match(pattern);
				if (match) {
					const todoContent = match[1]?.trim() || '';
					const relativePath = path.relative(rootDir, filePath);
					todos.push({
						id: `${relativePath}:${index + 1}`,
						file: relativePath,
						line: index + 1,
						content: todoContent,
						fullLine: line.trim(),
					});
					break;
				}
			}
		});

		return todos;
	} catch (error) {
		// Ignore files that can't be read
		return [];
	}
}

function scanDirectory(dir: string, rootDir: string): TodoItem[] {
	let todos: TodoItem[] = [];

	try {
		const entries = fs.readdirSync(dir, {withFileTypes: true});

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			const relativePath = path.relative(rootDir, fullPath);

			if (shouldIgnore(relativePath)) {
				continue;
			}

			if (entry.isDirectory()) {
				todos = todos.concat(scanDirectory(fullPath, rootDir));
			} else if (entry.isFile()) {
				// Only scan text files
				const ext = path.extname(entry.name).toLowerCase();
				const textExtensions = [
					'.ts',
					'.tsx',
					'.js',
					'.jsx',
					'.py',
					'.go',
					'.rs',
					'.java',
					'.c',
					'.cpp',
					'.h',
					'.hpp',
					'.cs',
					'.php',
					'.rb',
					'.swift',
					'.kt',
					'.scala',
					'.sh',
					'.bash',
					'.zsh',
					'.fish',
					'.vim',
					'.lua',
					'.sql',
					'.html',
					'.css',
					'.scss',
					'.sass',
					'.less',
					'.vue',
					'.svelte',
					'.md',
					'.txt',
					'.json',
					'.yaml',
					'.yml',
					'.toml',
					'.xml',
				];

				if (textExtensions.includes(ext) || ext === '') {
					todos = todos.concat(scanFileForTodos(fullPath, rootDir));
				}
			}
		}
	} catch (error) {
		// Ignore directories that can't be read
	}

	return todos;
}

export function scanProjectTodos(projectRoot: string): TodoItem[] {
	return scanDirectory(projectRoot, projectRoot);
}
