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
const __dirname = _fileURLToPath(new URL('.', import.meta.url));

// Polyfill for undici's web API dependencies
// undici uses File, Blob, etc. which are only available in Node.js 20+
// For Node.js 16-18, we provide minimal polyfills
if (typeof globalThis.File === 'undefined') {
  globalThis.File = class File {
    constructor(bits, name, options) {
      this.bits = bits;
      this.name = name;
      this.options = options;
    }
  };
}
if (typeof globalThis.FormData === 'undefined') {
  globalThis.FormData = class FormData {
    constructor() {
      this._data = new Map();
    }
    append(key, value) {
      this._data.set(key, value);
    }
    get(key) {
      return this._data.get(key);
    }
  };
}`,
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
