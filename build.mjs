import * as esbuild from 'esbuild';
import {copyFileSync, existsSync, mkdirSync} from 'fs';
import {builtinModules} from 'module';

// Plugin to stub out optional dependencies
const stubPlugin = {
	name: 'stub',
	setup(build) {
		build.onResolve({filter: /^react-devtools-core$/}, () => ({
			path: 'react-devtools-core',
			namespace: 'stub-ns',
		}));
		build.onLoad({filter: /.*/, namespace: 'stub-ns'}, () => ({
			contents: 'export default {}',
		}));
	},
};

// Create bundle directory
if (!existsSync('bundle')) {
	mkdirSync('bundle');
}

await esbuild.build({
	entryPoints: ['dist/cli.js'],
	bundle: true,
	platform: 'node',
	target: 'node16',
	format: 'esm',
	outfile: 'bundle/cli.mjs',
	banner: {
		js: `import { createRequire as _createRequire } from 'module';
import { fileURLToPath as _fileURLToPath } from 'url';
const require = _createRequire(import.meta.url);
const __filename = _fileURLToPath(import.meta.url);
const __dirname = _fileURLToPath(new URL('.', import.meta.url));`,
	},
	external: [
		// Only Node.js built-in modules should be external
		...builtinModules,
		...builtinModules.map(m => `node:${m}`),
		// Optional native dependencies (dynamically imported in code)
		'sharp',
	],
	plugins: [stubPlugin],
	minify: false,
	sourcemap: false,
	metafile: true,
	logLevel: 'info',
});

// Copy WASM files
copyFileSync(
	'node_modules/sql.js/dist/sql-wasm.wasm',
	'bundle/sql-wasm.wasm',
);
copyFileSync(
	'node_modules/tiktoken/tiktoken_bg.wasm',
	'bundle/tiktoken_bg.wasm',
);

// Copy PDF.js worker file for PDF parsing
copyFileSync(
	'node_modules/pdfjs-dist/build/pdf.worker.mjs',
	'bundle/pdf.worker.mjs',
);

console.log('✓ Bundle created successfully');
