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
}

// Polyfill browser APIs required by pdfjs-dist in Node.js environment.
// pdfjs-dist uses DOMMatrix/ImageData/Path2D at module level, so these must
// exist before any bundled pdfjs code executes.
// Only stubs are needed — we only do text extraction, not rendering.
if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor(init) {
      this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
      this.m11 = 1; this.m12 = 0; this.m13 = 0; this.m14 = 0;
      this.m21 = 0; this.m22 = 1; this.m23 = 0; this.m24 = 0;
      this.m31 = 0; this.m32 = 0; this.m33 = 1; this.m34 = 0;
      this.m41 = 0; this.m42 = 0; this.m43 = 0; this.m44 = 1;
      this.is2D = true; this.isIdentity = true;
      if (Array.isArray(init) && init.length === 6) {
        this.a = init[0]; this.b = init[1]; this.c = init[2];
        this.d = init[3]; this.e = init[4]; this.f = init[5];
        this.m11 = this.a; this.m12 = this.b;
        this.m21 = this.c; this.m22 = this.d;
        this.m41 = this.e; this.m42 = this.f;
      }
    }
    inverse() { return new DOMMatrix(); }
    multiply() { return new DOMMatrix(); }
    translate() { return new DOMMatrix(); }
    scale() { return new DOMMatrix(); }
    rotate() { return new DOMMatrix(); }
    scaleSelf() { return this; }
    translateSelf() { return this; }
    transformPoint() { return { x: 0, y: 0, z: 0, w: 1 }; }
  };
}
if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    constructor(sw, sh) {
      if (sw instanceof Uint8ClampedArray) {
        this.data = sw; this.width = sh; this.height = sw.length / (4 * sh);
      } else {
        this.width = sw; this.height = sh;
        this.data = new Uint8ClampedArray(sw * sh * 4);
      }
    }
  };
}
if (typeof globalThis.Path2D === 'undefined') {
  globalThis.Path2D = class Path2D {
    constructor() {}
    addPath() {} closePath() {} moveTo() {} lineTo() {}
    bezierCurveTo() {} quadraticCurveTo() {} arc() {} arcTo() {}
    ellipse() {} rect() {}
  };
}`,
	},
	external: [
		// Only Node.js built-in modules should be external
		...builtinModules,
		...builtinModules.map(m => `node:${m}`),
		// Optional native dependencies (dynamically imported in code)
		'sharp',
		// SSH2 includes native .node addons that cannot be bundled by esbuild
		'ssh2',
		'cpu-features',
		// Note: katex and markdown-it-math are bundled (not external)
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

// Copy package.json to bundle directory for version reading
copyFileSync('package.json', 'bundle/package.json');

console.log('✓ Bundle created successfully');
