/* eslint-disable unicorn/prefer-module */

const {execFileSync} = require('child_process');
const {copyFileSync, existsSync, mkdirSync, statSync} = require('fs');
const {join} = require('path');

const platform = process.platform;
const architecture = process.arch;
const target = process.env.SNOW_NATIVE_TARGET || `${platform}-${architecture}`;
const extension =
	platform === 'win32' ? 'dll' : platform === 'darwin' ? 'dylib' : 'so';
const libraryName =
	platform === 'win32'
		? `snow_native.${extension}`
		: `libsnow_native.${extension}`;
const source = join('crates', 'snow-native', 'target', 'release', libraryName);
const destinationDirectory = join('bundle', 'native');
const destination = join(destinationDirectory, `snow_native.${target}.node`);

/**
 * 比较源文件和目标文件的修改时间。
 * 如果源文件比目标文件新（或目标文件不存在），则需要重新编译和复制。
 * 如果目标文件比源文件新或相同，说明 native 库没有变化，可以跳过。
 */
function isNativeStale() {
	if (!existsSync(source)) {
		// 源文件不存在，需要编译
		return true;
	}
	if (!existsSync(destination)) {
		// 目标文件不存在，需要复制
		return true;
	}
	// 比较修改时间：源文件比目标文件新则 stale
	const sourceMtime = statSync(source).mtimeMs;
	const destMtime = statSync(destination).mtimeMs;
	return sourceMtime > destMtime;
}

/**
 * 尝试复制文件，如果目标文件被锁定（EBUSY/EPERM）则跳过。
 * 这通常发生在 snow CLI 正在运行时。
 */
function tryCopyFile(src, dest) {
	try {
		copyFileSync(src, dest);
		console.log(`Native edit accelerator created: ${dest}`);
	} catch (error) {
		if (error.code === 'EBUSY' || error.code === 'EPERM') {
			console.log(
				`Native target ${dest} is locked (likely in use). Skipping copy — existing file will be used.`,
			);
		} else {
			throw error;
		}
	}
}

// 检查是否需要重新编译 native 库
if (!isNativeStale()) {
	console.log(
		`Native accelerator up to date (${destination}). Skipping cargo build.`,
	);
} else {
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
	tryCopyFile(source, destination);
}
