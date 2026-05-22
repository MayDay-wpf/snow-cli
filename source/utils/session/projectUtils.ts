import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

/**
 * 项目工具函数 - 用于获取项目标识
 *
 * 路径结构: ~/.snow/sessions/项目名/YYYYMMDD/UUID.json
 * 参考 Claude Code 的设计
 */

const PROJECT_ID_HASH_LENGTH = 6;
const PROJECT_REGISTRY_VERSION = 1;

export type ProjectIdentity = {
	/** 稳定项目 ID，新数据统一写入该目录 */
	projectId: string;
	/** 旧版本基于当前绝对工作目录生成的 ID */
	pathProjectId: string;
	/** 当前工作目录 */
	projectPath: string;
	/** 识别到的项目根目录（优先 .git / package.json） */
	projectRoot: string;
	/** 展示用项目名 */
	projectName: string;
	/** 可作为当前项目读取来源的旧项目 ID */
	projectAliasIds: string[];
	/** 用于跨路径识别同一项目的指纹 */
	fingerprint: string;
};

type PackageJsonData = {
	name?: unknown;
	repository?: unknown;
};

type ProjectRegistryEntry = {
	projectId: string;
	displayName: string;
	fingerprint: string;
	knownPaths: string[];
	aliases: string[];
	createdAt: number;
	updatedAt: number;
};

type ProjectRegistry = {
	version: number;
	projects: Record<string, ProjectRegistryEntry>;
};

function createShortHash(value: string): string {
	return crypto
		.createHash('sha256')
		.update(value)
		.digest('hex')
		.slice(0, PROJECT_ID_HASH_LENGTH);
}

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
	const pathHash = createShortHash(cwd);
	const safeDirName = sanitizeProjectName(dirName) || 'project';

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

function getSnowDir(): string {
	return path.join(os.homedir(), '.snow');
}

function getProjectRegistryPath(): string {
	return path.join(getSnowDir(), 'projects', 'index.json');
}

function pathExists(targetPath: string): boolean {
	try {
		fs.accessSync(targetPath);
		return true;
	} catch {
		return false;
	}
}

function findProjectRoot(projectPath: string): string {
	let current = path.resolve(projectPath);

	while (true) {
		if (
			pathExists(path.join(current, '.git')) ||
			pathExists(path.join(current, 'package.json'))
		) {
			return current;
		}

		const parent = path.dirname(current);
		if (parent === current) {
			return path.resolve(projectPath);
		}

		current = parent;
	}
}

function readPackageJson(projectRoot: string): PackageJsonData | undefined {
	try {
		const packageJsonPath = path.join(projectRoot, 'package.json');
		const data = fs.readFileSync(packageJsonPath, 'utf-8');
		return JSON.parse(data) as PackageJsonData;
	} catch {
		return undefined;
	}
}

function getRepositoryUrl(repository: unknown): string | undefined {
	if (typeof repository === 'string') {
		return repository;
	}

	if (repository && typeof repository === 'object' && 'url' in repository) {
		const {url} = repository as {url?: unknown};
		return typeof url === 'string' ? url : undefined;
	}

	return undefined;
}

function resolveGitConfigPath(projectRoot: string): string | undefined {
	const gitPath = path.join(projectRoot, '.git');

	try {
		const stat = fs.statSync(gitPath);
		if (stat.isDirectory()) {
			return path.join(gitPath, 'config');
		}

		if (stat.isFile()) {
			const content = fs.readFileSync(gitPath, 'utf-8');
			const match = /^gitdir:\s*(.+)$/im.exec(content);
			if (!match?.[1]) {
				return undefined;
			}

			const gitDir = path.isAbsolute(match[1])
				? match[1]
				: path.resolve(projectRoot, match[1]);
			return path.join(gitDir, 'config');
		}
	} catch {
		return undefined;
	}

	return undefined;
}

function readGitRemote(projectRoot: string): string | undefined {
	const gitConfigPath = resolveGitConfigPath(projectRoot);
	if (!gitConfigPath) {
		return undefined;
	}

	try {
		const content = fs.readFileSync(gitConfigPath, 'utf-8');
		const originSection = /\[remote "origin"\]([\s\S]*?)(?=\n\[|$)/.exec(content);
		const originUrl = originSection?.[1]
			? /^\s*url\s*=\s*(.+)$/im.exec(originSection[1])?.[1]
			: undefined;
		if (originUrl) {
			return originUrl.trim();
		}

		return /^\s*url\s*=\s*(.+)$/im.exec(content)?.[1]?.trim();
	} catch {
		return undefined;
	}
}

function normalizeRepositoryUrl(repositoryUrl: string): string {
	return repositoryUrl
		.trim()
		.replace(/^git\+/, '')
		.replace(/^ssh:\/\/git@/, '')
		.replace(/^https?:\/\//, '')
		.replace(/^git@([^:]+):/, '$1/')
		.replace(/\.git$/i, '')
		.toLowerCase();
}

function createProjectFingerprint(
	projectRoot: string,
	projectPath: string,
	packageJson: PackageJsonData | undefined,
): string {
	const gitRemote = readGitRemote(projectRoot);
	if (gitRemote) {
		return `git:${normalizeRepositoryUrl(gitRemote)}`;
	}

	const repositoryUrl = getRepositoryUrl(packageJson?.repository);
	if (repositoryUrl) {
		return `repo:${normalizeRepositoryUrl(repositoryUrl)}`;
	}

	if (typeof packageJson?.name === 'string' && packageJson.name.trim()) {
		return `pkg:${packageJson.name.trim()}:${path.basename(projectRoot)}`;
	}

	return `path:${path.resolve(projectPath)}`;
}

function readProjectRegistry(): ProjectRegistry {
	try {
		const data = fs.readFileSync(getProjectRegistryPath(), 'utf-8');
		const parsed = JSON.parse(data) as ProjectRegistry;
		return {
			version: parsed.version || PROJECT_REGISTRY_VERSION,
			projects: parsed.projects || {},
		};
	} catch {
		return {version: PROJECT_REGISTRY_VERSION, projects: {}};
	}
}

function writeProjectRegistry(registry: ProjectRegistry): void {
	try {
		const registryPath = getProjectRegistryPath();
		fs.mkdirSync(path.dirname(registryPath), {recursive: true});
		fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf-8');
	} catch {
		// 项目注册表只是兼容性加速索引，写入失败不应影响主流程。
	}
}

function discoverProjectIdsByName(projectNames: string[]): string[] {
	const discovered = new Set<string>();
	const uniqueNames = [...new Set(projectNames.filter(Boolean))];
	const parentDirs = [
		path.join(getSnowDir(), 'sessions'),
		path.join(getSnowDir(), 'history'),
	];

	for (const parentDir of parentDirs) {
		try {
			const files = fs.readdirSync(parentDir, {withFileTypes: true});
			for (const file of files) {
				if (!file.isDirectory() || !isProjectFolder(file.name)) {
					continue;
				}

				const matchingName = uniqueNames.some(projectName =>
					file.name.startsWith(`${projectName}-`),
				);
				if (matchingName) {
					discovered.add(file.name);
				}
			}
		} catch {
			// 目录不存在或不可读时跳过，保持完全无感。
		}
	}

	return [...discovered];
}

function collectRegistryAliases(
	registry: ProjectRegistry,
	fingerprint: string,
	projectPath: string,
): string[] {
	const aliases = new Set<string>();

	for (const entry of Object.values(registry.projects)) {
		const fingerprintMatched = entry.fingerprint === fingerprint;
		const pathMatched = entry.knownPaths.includes(projectPath);
		if (!fingerprintMatched && !pathMatched) {
			continue;
		}

		aliases.add(entry.projectId);
		for (const alias of entry.aliases) {
			aliases.add(alias);
		}
	}

	return [...aliases];
}

function rememberProjectIdentity(identity: ProjectIdentity): void {
	const registry = readProjectRegistry();
	const now = Date.now();
	const existing = registry.projects[identity.projectId];
	const knownPaths = new Set(existing?.knownPaths || []);
	knownPaths.add(identity.projectPath);

	registry.projects[identity.projectId] = {
		projectId: identity.projectId,
		displayName: identity.projectName,
		fingerprint: identity.fingerprint,
		knownPaths: [...knownPaths],
		aliases: identity.projectAliasIds,
		createdAt: existing?.createdAt || now,
		updatedAt: now,
	};

	writeProjectRegistry(registry);
}

/**
 * 解析当前项目的稳定身份。
 *
 * 新版本使用 git remote / package repository / package name 等稳定指纹生成 projectId，
 * 同时自动发现旧版本基于绝对路径生成的项目目录别名。这样用户已经移动工作目录后，
 * 新版本仍能直接读取旧历史与会话，无需手动迁移。
 */
export function resolveProjectIdentity(projectPath = getProjectPath()): ProjectIdentity {
	const resolvedProjectPath = path.resolve(projectPath);
	const projectRoot = findProjectRoot(resolvedProjectPath);
	const packageJson = readPackageJson(projectRoot);
	const projectName = path.basename(projectRoot || resolvedProjectPath);
	const safeProjectName = sanitizeProjectName(projectName) || 'project';
	const safeCurrentDirName =
		sanitizeProjectName(path.basename(resolvedProjectPath)) || safeProjectName;
	const pathProjectId = getProjectId(resolvedProjectPath);
	const fingerprint = createProjectFingerprint(
		projectRoot,
		resolvedProjectPath,
		packageJson,
	);
	const projectId = fingerprint.startsWith('path:')
		? pathProjectId
		: `${safeProjectName}-${createShortHash(fingerprint)}`;
	const registry = readProjectRegistry();
	const aliases = new Set<string>([
		pathProjectId,
		...collectRegistryAliases(registry, fingerprint, resolvedProjectPath),
		...discoverProjectIdsByName([safeProjectName, safeCurrentDirName]),
	]);
	aliases.delete(projectId);

	const identity: ProjectIdentity = {
		projectId,
		pathProjectId,
		projectPath: resolvedProjectPath,
		projectRoot,
		projectName,
		projectAliasIds: [...aliases],
		fingerprint,
	};

	rememberProjectIdentity(identity);
	return identity;
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
