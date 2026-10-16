import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseCanonicalPath, type StructuredPath} from '../../utils/core/canonicalPath.js';
import {withEnvOverrides} from '../../utils/config/envConfig.js';

export interface SandboxEnvironment {
	/** 沙箱工作目录（原生格式） */
	readonly cwd: string;
	/** 沙箱工作目录结构化对象（不可变 POSIX 结构） */
	readonly structuredCwd: StructuredPath;
	/** 沙箱配置根目录（等价于重定向后的 SNOW_CONFIG_DIR） */
	readonly configDir: string;
	/** 沙箱配置目录结构化对象 */
	readonly structuredConfigDir: StructuredPath;
	/** 清理沙箱产生的临时文件 */
	cleanup: () => void;
	/** 在沙箱专属环境变量作用域中执行回调，100% 防止宿主泄漏 */
	runWithSandboxEnv: <T>(fn: () => Promise<T> | T) => Promise<T>;
}

/**
 * 创建完全沙箱化的隔离测试环境
 * 1. 自动生成独立工作区目录（`cwd`）与独立全局配置目录（`configDir`）；
 * 2. 自动注入 `SNOW_CONFIG_DIR`，确保全局配置、历史、会话、日志零污染宿主 `~/.snow`；
 * 3. 回调退出或测试结束后提供安全的物理清理。
 */
export function createSandboxDir(prefix = 'snow-sandbox-'): SandboxEnvironment {
	const rootTemp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	const cwd = path.join(rootTemp, 'workspace');
	const configDir = path.join(rootTemp, 'global-snow');

	fs.mkdirSync(cwd, {recursive: true});
	fs.mkdirSync(configDir, {recursive: true});

	const structuredCwd = parseCanonicalPath(cwd);
	const structuredConfigDir = parseCanonicalPath(configDir);

	return {
		cwd,
		structuredCwd,
		configDir,
		structuredConfigDir,
		cleanup: () => {
			try {
				if (fs.existsSync(rootTemp)) {
					fs.rmSync(rootTemp, {recursive: true, force: true});
				}
			} catch {
				// Best-effort cleanup on windows locked files
			}
		},
		runWithSandboxEnv: async <T>(fn: () => Promise<T> | T): Promise<T> => {
			return withEnvOverrides(
				{
					SNOW_CONFIG_DIR: configDir,
				},
				fn,
			);
		},
	};
}
