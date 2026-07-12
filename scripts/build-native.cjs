/* eslint-disable unicorn/prefer-module */

const {execFileSync} = require('child_process');
const {copyFileSync, existsSync, mkdirSync} = require('fs');
const {join} = require('path');

const platform = process.platform;
const architecture = process.arch;
const target = process.env.SNOW_NATIVE_TARGET || `${platform}-${architecture}`;
const extension =
	platform === 'win32' ? 'dll' : platform === 'darwin' ? 'dylib' : 'so';
const source = join('crates', 'snow-native', 'target', 'release', `snow_native.${extension}`);
const destinationDirectory = join('bundle', 'native');
const destination = join(destinationDirectory, `snow_native.${target}.node`);
execFileSync(
	'cargo',
	['build', '--manifest-path', 'crates/snow-native/Cargo.toml', '--release'],
	{
		stdio: 'inherit',
	},
);

if (!existsSync(source)) {
	throw new Error(`Rust native build did not create ${source}`);
}

mkdirSync(destinationDirectory, {recursive: true});
copyFileSync(source, destination);
console.log(`Native edit accelerator created: ${destination}`);
