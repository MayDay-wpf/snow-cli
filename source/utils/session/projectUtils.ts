import path from 'path';
import crypto from 'crypto';

/**
 * 项目工具函数 - 用于获取项目标识
 * 
 * 路径结构: ~/.snow/sessions/项目名/YYYYMMDD/UUID.json
 * 参考 Claude Code 的设计
 */

/**
 * 获取当前项目的唯一标识符
 * 使用目录名作为主标识，附加短哈希确保唯一性
 * 
 * @param projectPath - 项目路径，默认为当前工作目录
 * @returns 项目ID，格式为 "目录名-短哈希"
 */
export function getProjectId(projectPath?: string): string {
	const cwd = projectPath || process.cwd();
	const dirName = path.basename(cwd);
	
	// 生成路径的短哈希（6位）以区分同名目录
	const pathHash = crypto
		.createHash('sha256')
		.update(cwd)
		.digest('hex')
		.slice(0, 6);
	
	// 清理目录名，移除不安全字符
	const safeDirName = sanitizeProjectName(dirName);
	
	return `${safeDirName}-${pathHash}`;
}

/**
 * 获取当前项目的简短名称（仅目录名）
 * 用于显示目的
 * 
 * @param projectPath - 项目路径，默认为当前工作目录
 * @returns 项目目录名
 */
export function getProjectName(projectPath?: string): string {
	const cwd = projectPath || process.cwd();
	return path.basename(cwd);
}

/**
 * 获取当前项目的完整路径
 * 
 * @returns 项目完整路径
 */
export function getProjectPath(): string {
	return process.cwd();
}

/**
 * 清理项目名称，移除不安全的文件系统字符
 * 
 * @param name - 原始项目名
 * @returns 安全的项目名
 */
export function sanitizeProjectName(name: string): string {
	// 移除或替换不安全的文件系统字符
	return name
		.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') // 替换 Windows 不允许的字符
		.replace(/\s+/g, '_') // 空格替换为下划线
		.replace(/_+/g, '_') // 多个下划线合并
		.replace(/^_|_$/g, '') // 移除首尾下划线
		.slice(0, 100); // 限制长度
}

/**
 * 格式化日期为文件夹名称 (YYYYMMDD)
 * 注意：使用紧凑格式，不带连字符
 * 
 * @param date - 日期对象
 * @returns 格式化的日期字符串 (YYYYMMDD)
 */
export function formatDateCompact(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}${month}${day}`;
}

/**
 * 检查路径是否为日期文件夹（旧格式 YYYY-MM-DD 或新格式 YYYYMMDD）
 * 
 * @param folderName - 文件夹名称
 * @returns 是否为日期格式
 */
export function isDateFolder(folderName: string): boolean {
	// 匹配 YYYY-MM-DD 或 YYYYMMDD 格式
	return /^\d{4}-?\d{2}-?\d{2}$/.test(folderName);
}

/**
 * 检查路径是否为项目文件夹（项目名-哈希 格式）
 * 
 * @param folderName - 文件夹名称
 * @returns 是否为项目文件夹格式
 */
export function isProjectFolder(folderName: string): boolean {
	// 匹配 项目名-6位哈希 格式
	return /^.+-[a-f0-9]{6}$/.test(folderName);
}
