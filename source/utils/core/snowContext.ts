import os from 'node:os';
import path from 'node:path';
import {parseCanonicalPath, type StructuredPath} from './canonicalPath.js';
import {getSnowEnv} from '../config/envConfig.js';

/**
 * SnowContext 全局与工作区统一存储上下文
 *
 * 核心防御原则：
 * 1. 彻底根除散落在全库各处的直读 `path.join(os.homedir(), '.snow')`，收敛为唯一源头；
 * 2. 彻底根除未校验的直读 `path.join(process.cwd(), '.snow')`；
 * 3. 当存在沙箱配置目录时（SNOW_CONFIG_DIR），全局存储 100% 隔离至沙箱，宿主真实 ~/.snow 零污染；
 * 4. 全链路输出与接收使用不可变 `StructuredPath`，防止路径反斜杠与跨盘符混淆。
 */

/**
 * 获取全局 Snow 根目录（~/.snow 或沙箱目录）
 */
export function getGlobalSnowDir(): StructuredPath {
	const env = getSnowEnv();
	if (env.configDir) {
		return env.configDir;
	}
	return parseCanonicalPath(path.join(os.homedir(), '.snow'));
}

/**
 * 获取指定项目工作区的 Snow 目录（默认为 <cwd>/.snow）
 */
export function getWorkspaceSnowDir(workingDirectory?: string): StructuredPath {
	const baseDir = workingDirectory || process.cwd();
	return parseCanonicalPath(path.join(baseDir, '.snow'));
}

/**
 * 获取全局或工作区指定子域路径的结构化表示
 * @param domain 子域路径名称，如 'log', 'sessions', 'tasks', 'checkpoints', 'theme.json'
 * @param scope 'global' | 'workspace'
 * @param workingDirectory 可选的工作区根目录
 */
export function getSnowPath(
	domain: string,
	scope: 'global' | 'workspace' = 'global',
	workingDirectory?: string,
): StructuredPath {
	const root = scope === 'global' ? getGlobalSnowDir() : getWorkspaceSnowDir(workingDirectory);
	return root.join(domain);
}
