/* eslint-disable unicorn/prefer-module */

/**
 * 清理构建产物目录，避免 tsc 残留旧输出导致 bundle 与 source 不一致。
 *
 * 说明：
 * - tsc 默认不会删除已不存在源文件对应的 dist 输出文件
 * - build.mjs 依赖 dist/ 作为入口进行打包
 * - 因此在 build 前清理 dist/ 与 bundle/ 可显著降低“幽灵文件”带来的回归风险
 */

const fs = require('fs');

for (const dir of ['dist', 'bundle']) {
	try {
		fs.rmSync(dir, {recursive: true, force: true});
	} catch {
		// 清理失败不应阻断构建流程
	}
}
