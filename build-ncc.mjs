import {exec} from 'child_process';
import {promisify} from 'util';
import {copyFileSync, mkdirSync, existsSync} from 'fs';
import {join} from 'path';

const execAsync = promisify(exec);

// Create bundle directory
if (!existsSync('bundle')) {
	mkdirSync('bundle');
}

// Run ncc
console.log('Building with ncc...');
await execAsync('ncc build dist/cli.js -o bundle --minify');

// Copy WASM file
copyFileSync(
	'node_modules/sql.js/dist/sql-wasm.wasm',
	'bundle/sql-wasm.wasm',
);

// Rename index.js to cli.cjs
if (existsSync('bundle/index.js')) {
	const {renameSync} = await import('fs');
	renameSync('bundle/index.js', 'bundle/cli.cjs');
}

console.log('✓ Bundle created successfully');
