/**
 * ~/.snow 数据清理服务（Issue #208）。
 *
 * 提供两种清理方式：
 * 1. 按项目清理：删除所选项目在 sessions / snapshots / history / todos / goals /
 *    teams 等「项目维度」目录下的全部数据。
 * 2. 按时间清理：删除早于指定天数的文件，覆盖日志、用量统计、导出文件等全局数据。
 *
 * 所有统计与删除都基于真实磁盘扫描，不存在的路径会被安全忽略；
 * 判定「过期」时统一使用文件 mtime，删除文件后再自底向上回收空目录。
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import {isProjectFolder} from '../session/projectUtils.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 按时间清理时可选的天数档位 */
export const CLEANUP_DAY_OPTIONS: readonly number[] = [7, 15, 30, 90];

export type CleanupCategoryId =
	| 'sessions'
	| 'snapshots'
	| 'history'
	| 'todos'
	| 'goals'
	| 'teams'
	| 'tasks'
	| 'logs'
	| 'usage'
	| 'exports';

/** project: 每个项目独立一份数据；global: 全局共享数据 */
export type CleanupCategoryScope = 'project' | 'global';

export type CleanupCategoryMeta = {
	id: CleanupCategoryId;
	scope: CleanupCategoryScope;
};

export const CLEANUP_CATEGORIES: readonly CleanupCategoryMeta[] = [
	{id: 'sessions', scope: 'project'},
	{id: 'snapshots', scope: 'project'},
	{id: 'history', scope: 'project'},
	{id: 'todos', scope: 'project'},
	{id: 'goals', scope: 'project'},
	{id: 'teams', scope: 'project'},
	{id: 'logs', scope: 'global'},
	{id: 'tasks', scope: 'global'},
	{id: 'usage', scope: 'global'},
	{id: 'exports', scope: 'global'},
];

export const ALL_CLEANUP_CATEGORY_IDS: readonly CleanupCategoryId[] =
	CLEANUP_CATEGORIES.map(category => category.id);

export function getCleanupCategories(
	scope?: CleanupCategoryScope,
): CleanupCategoryMeta[] {
	return scope
		? CLEANUP_CATEGORIES.filter(category => category.scope === scope)
		: [...CLEANUP_CATEGORIES];
}

export type SizeStats = {
	files: number;
	bytes: number;
};

export type CleanupProjectInfo = {
	projectId: string;
	displayName: string;
	/** 该身份对应的磁盘目录名（含历史别名目录） */
	dirNames: string[];
	categories: Partial<Record<CleanupCategoryId, SizeStats>>;
	total: SizeStats;
};

export type CleanupOverview = {
	total: SizeStats;
	categories: Partial<Record<CleanupCategoryId, SizeStats>>;
};

export type CleanupDeleteResult = {
	deletedFiles: number;
	deletedBytes: number;
	/** 被移除的目录/文件条目数量（顶层目标） */
	removedTargets: number;
	errors: string[];
};

type ProjectCategoryTarget = {
	category: CleanupCategoryId;
	targetPath: string;
};

type ProjectIdentityInfo = {
	projectId: string;
	displayName: string;
	dirNames: string[];
};

type RegistryEntry = {
	projectId: string;
	displayName: string;
	aliases: string[];
};

/**
 * 解析 ~/.snow 根目录。
 * 与 apiConfig.resolveSnowConfigDir 保持一致，但刻意不 import 该模块，
 * 避免引入其模块级副作用（proxy 迁移等）。
 */
export function getSnowRootDir(): string {
	const override = process.env['SNOW_CONFIG_DIR']?.trim();
	return override ? override : path.join(os.homedir(), '.snow');
}

export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return '0 B';
	}

	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const exponent = Math.min(
		Math.floor(Math.log(bytes) / Math.log(1024)),
		units.length - 1,
	);
	const value = bytes / 1024 ** exponent;
	const digits = exponent === 0 || value >= 100 ? 0 : 1;
	return `${value.toFixed(digits)} ${units[exponent] ?? 'B'}`;
}

function emptyStats(): SizeStats {
	return {files: 0, bytes: 0};
}

function sumStats(target: SizeStats, source: SizeStats): void {
	target.files += source.files;
	target.bytes += source.bytes;
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function pathExists(targetPath: string): boolean {
	try {
		return fs.existsSync(targetPath);
	} catch {
		return false;
	}
}

/** 递归统计路径下的文件数与总字节数；路径不存在时返回 0。 */
export function scanPathStats(targetPath: string): SizeStats {
	const stats = emptyStats();
	let entry: fs.Stats;
	try {
		entry = fs.statSync(targetPath);
	} catch {
		return stats;
	}

	if (entry.isFile()) {
		stats.files = 1;
		stats.bytes = entry.size;
		return stats;
	}

	if (!entry.isDirectory()) {
		return stats;
	}

	let children: string[];
	try {
		children = fs.readdirSync(targetPath);
	} catch {
		return stats;
	}

	for (const child of children) {
		sumStats(stats, scanPathStats(path.join(targetPath, child)));
	}

	return stats;
}

/**
 * 每个分类在磁盘上的根路径（可能多个）。
 * 按时间清理时直接遍历这些根路径，天然覆盖项目子目录与历史遗留目录。
 */
function getCategoryBasePaths(category: CleanupCategoryId): string[] {
	const root = getSnowRootDir();
	switch (category) {
		case 'sessions': {
			return [path.join(root, 'sessions')];
		}

		case 'snapshots': {
			return [path.join(root, 'snapshots')];
		}

		case 'history': {
			return [path.join(root, 'history'), path.join(root, 'history.json')];
		}

		case 'todos': {
			return [path.join(root, 'todos'), path.join(root, 'todo-snapshots')];
		}

		case 'goals': {
			return [path.join(root, 'goals')];
		}

		case 'teams': {
			return [path.join(root, 'teams'), path.join(root, 'team-snapshots')];
		}

		case 'logs': {
			return [
				path.join(root, 'log'),
				path.join(root, 'loop-logs'),
				path.join(root, 'sse-logs'),
				path.join(root, 'task-logs'),
			];
		}

		case 'tasks': {
			return [path.join(root, 'tasks')];
		}

		case 'usage': {
			return [path.join(root, 'usage')];
		}

		case 'exports': {
			return [path.join(root, 'exports')];
		}

		default: {
			return [];
		}
	}
}

/** 单个项目在「项目维度」分类下的具体目标路径。 */
function getProjectCategoryTargets(projectId: string): ProjectCategoryTarget[] {
	const root = getSnowRootDir();
	return [
		{
			category: 'sessions',
			targetPath: path.join(root, 'sessions', projectId),
		},
		{
			category: 'snapshots',
			targetPath: path.join(root, 'snapshots', projectId),
		},
		{
			category: 'history',
			targetPath: path.join(root, 'history', projectId),
		},
		{
			category: 'todos',
			targetPath: path.join(root, 'todos', projectId),
		},
		{
			category: 'todos',
			targetPath: path.join(root, 'todo-snapshots', `${projectId}.json`),
		},
		{
			category: 'goals',
			targetPath: path.join(root, 'goals', projectId),
		},
		{
			category: 'teams',
			targetPath: path.join(root, 'team-snapshots', `${projectId}.json`),
		},
	];
}

function readDirNames(dirPath: string): string[] {
	try {
		return fs.readdirSync(dirPath);
	} catch {
		return [];
	}
}

function isDirectory(targetPath: string): boolean {
	try {
		return fs.statSync(targetPath).isDirectory();
	} catch {
		return false;
	}
}

/** 扫描磁盘上实际存在的项目目录名（含旧版路径别名）。 */
function listProjectDirNames(): Set<string> {
	const root = getSnowRootDir();
	const names = new Set<string>();

	for (const sub of ['sessions', 'snapshots', 'history', 'goals', 'todos']) {
		const base = path.join(root, sub);
		for (const name of readDirNames(base)) {
			if (isProjectFolder(name) && isDirectory(path.join(base, name))) {
				names.add(name);
			}
		}
	}

	// 以单个文件形式存储的项目维度数据
	for (const sub of ['todo-snapshots', 'team-snapshots']) {
		const base = path.join(root, sub);
		for (const name of readDirNames(base)) {
			if (!name.endsWith('.json')) {
				continue;
			}

			const id = name.slice(0, -'.json'.length);
			if (isProjectFolder(id)) {
				names.add(id);
			}
		}
	}

	return names;
}

function readProjectRegistry(): RegistryEntry[] {
	const indexPath = path.join(getSnowRootDir(), 'projects', 'index.json');

	let raw: unknown;
	try {
		raw = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
	} catch {
		return [];
	}

	const projects =
		raw && typeof raw === 'object'
			? (raw as {projects?: unknown}).projects
			: undefined;
	if (!projects || typeof projects !== 'object') {
		return [];
	}

	const entries: RegistryEntry[] = [];
	for (const [projectId, value] of Object.entries(
		projects as Record<string, unknown>,
	)) {
		const record =
			value && typeof value === 'object'
				? (value as {displayName?: unknown; aliases?: unknown})
				: {};
		const displayName =
			typeof record.displayName === 'string' && record.displayName.trim()
				? record.displayName.trim()
				: projectId;
		const aliases = Array.isArray(record.aliases)
			? record.aliases.filter(
					(alias): alias is string => typeof alias === 'string',
			  )
			: [];
		entries.push({projectId, displayName, aliases});
	}

	return entries;
}

/**
 * 把磁盘目录名归并成项目身份：
 * projects/index.json 记录的主 id 与别名目录会被合并为一个项目条目。
 */
function buildProjectIdentityMap(): Map<string, ProjectIdentityInfo> {
	const dirNames = listProjectDirNames();
	const registry = readProjectRegistry();
	const identityMap = new Map<string, ProjectIdentityInfo>();
	const assigned = new Set<string>();

	for (const entry of registry) {
		const candidates = [entry.projectId, ...entry.aliases].filter(
			name => dirNames.has(name) && !assigned.has(name),
		);
		if (candidates.length === 0) {
			continue;
		}

		identityMap.set(entry.projectId, {
			projectId: entry.projectId,
			displayName: entry.displayName,
			dirNames: candidates,
		});
		for (const name of candidates) {
			assigned.add(name);
		}
	}

	for (const dirName of dirNames) {
		if (assigned.has(dirName)) {
			continue;
		}

		identityMap.set(dirName, {
			projectId: dirName,
			displayName: dirName,
			dirNames: [dirName],
		});
	}

	return identityMap;
}

/** 扫描所有项目维度的数据（供「按项目清理」列表使用）。 */
export function scanProjects(): CleanupProjectInfo[] {
	const identityMap = buildProjectIdentityMap();
	const projects: CleanupProjectInfo[] = [];

	for (const identity of identityMap.values()) {
		const categories: Partial<Record<CleanupCategoryId, SizeStats>> = {};
		const total = emptyStats();

		for (const dirName of identity.dirNames) {
			for (const target of getProjectCategoryTargets(dirName)) {
				const stats = scanPathStats(target.targetPath);
				if (stats.files === 0) {
					continue;
				}

				const existing = categories[target.category] ?? emptyStats();
				sumStats(existing, stats);
				categories[target.category] = existing;
				sumStats(total, stats);
			}
		}

		if (total.files === 0) {
			continue;
		}

		projects.push({
			projectId: identity.projectId,
			displayName: identity.displayName,
			dirNames: identity.dirNames,
			categories,
			total,
		});
	}

	projects.sort((a, b) => b.total.bytes - a.total.bytes);
	return projects;
}

/** 扫描各分类的总体占用（供面板顶部总览使用）。 */
export function scanCleanupOverview(
	categories: readonly CleanupCategoryId[] = ALL_CLEANUP_CATEGORY_IDS,
): CleanupOverview {
	const categoryStats: Partial<Record<CleanupCategoryId, SizeStats>> = {};
	const total = emptyStats();

	for (const category of categories) {
		const stats = emptyStats();
		for (const basePath of getCategoryBasePaths(category)) {
			sumStats(stats, scanPathStats(basePath));
		}

		categoryStats[category] = stats;
		sumStats(total, stats);
	}

	return {total, categories: categoryStats};
}

function createEmptyResult(): CleanupDeleteResult {
	return {
		deletedFiles: 0,
		deletedBytes: 0,
		removedTargets: 0,
		errors: [],
	};
}

function removeTarget(targetPath: string, result: CleanupDeleteResult): void {
	if (!pathExists(targetPath)) {
		return;
	}

	const stats = scanPathStats(targetPath);
	try {
		fs.rmSync(targetPath, {recursive: true, force: true});
		result.deletedFiles += stats.files;
		result.deletedBytes += stats.bytes;
		result.removedTargets += 1;
	} catch (error) {
		result.errors.push(`${targetPath}: ${toErrorMessage(error)}`);
	}
}

/**
 * 按项目删除数据。
 * @param projectIds 目标项目 id（scanProjects 返回的 projectId）
 * @param categories 需要清理的分类（仅项目维度分类有效）
 */
export function deleteProjectData(
	projectIds: readonly string[],
	categories: readonly CleanupCategoryId[],
): CleanupDeleteResult {
	const result = createEmptyResult();
	const identityMap = buildProjectIdentityMap();

	for (const projectId of projectIds) {
		const identity = identityMap.get(projectId);
		const dirNames = identity ? identity.dirNames : [projectId];

		for (const dirName of dirNames) {
			for (const target of getProjectCategoryTargets(dirName)) {
				if (!categories.includes(target.category)) {
					continue;
				}

				removeTarget(target.targetPath, result);
			}
		}
	}

	return result;
}

function deleteOlderThanInPath(
	targetPath: string,
	cutoff: number,
	result: CleanupDeleteResult,
	removeEmptyDir: boolean,
): void {
	let entry: fs.Stats;
	try {
		entry = fs.statSync(targetPath);
	} catch {
		return;
	}

	if (entry.isFile()) {
		if (entry.mtimeMs >= cutoff) {
			return;
		}

		try {
			fs.rmSync(targetPath, {force: true});
			result.deletedFiles += 1;
			result.deletedBytes += entry.size;
		} catch (error) {
			result.errors.push(`${targetPath}: ${toErrorMessage(error)}`);
		}

		return;
	}

	if (!entry.isDirectory()) {
		return;
	}

	let children: string[];
	try {
		children = fs.readdirSync(targetPath);
	} catch {
		return;
	}

	for (const child of children) {
		deleteOlderThanInPath(path.join(targetPath, child), cutoff, result, true);
	}

	if (!removeEmptyDir) {
		return;
	}

	// 文件全部过期后回收空目录，避免留下空壳
	try {
		if (fs.readdirSync(targetPath).length === 0) {
			fs.rmdirSync(targetPath);
		}
	} catch {
		// 目录非空或已被并发移除时忽略
	}
}

function resolveCutoff(days: number): number {
	return Date.now() - Math.max(1, Math.floor(days)) * DAY_MS;
}

/** 统计「早于指定天数」的数据量，用于删除前展示。 */
export function scanOlderThan(
	days: number,
	categories: readonly CleanupCategoryId[] = ALL_CLEANUP_CATEGORY_IDS,
): SizeStats {
	const [stats] = scanOlderThanBuckets([days], categories);
	return stats ?? emptyStats();
}

function collectAgeBuckets(
	targetPath: string,
	cutoffs: readonly number[],
	buckets: SizeStats[],
): void {
	let entry: fs.Stats;
	try {
		entry = fs.statSync(targetPath);
	} catch {
		return;
	}

	if (entry.isFile()) {
		for (let i = 0; i < cutoffs.length; i += 1) {
			const cutoff = cutoffs[i];
			if (cutoff !== undefined && entry.mtimeMs < cutoff) {
				const bucket = buckets[i];
				if (bucket) {
					bucket.files += 1;
					bucket.bytes += entry.size;
				}
			}
		}

		return;
	}

	if (!entry.isDirectory()) {
		return;
	}

	let children: string[];
	try {
		children = fs.readdirSync(targetPath);
	} catch {
		return;
	}

	for (const child of children) {
		collectAgeBuckets(path.join(targetPath, child), cutoffs, buckets);
	}
}

/**
 * 一次性统计多个天数档位的数据量（单次磁盘遍历）。
 * 返回数组顺序与传入的 daysList 一致，用于面板中实时展示各档位可清理量，
 * 避免每个档位各做一次全盘扫描。
 */
export function scanOlderThanBuckets(
	daysList: readonly number[],
	categories: readonly CleanupCategoryId[] = ALL_CLEANUP_CATEGORY_IDS,
): SizeStats[] {
	const cutoffs = daysList.map(days => resolveCutoff(days));
	const buckets = daysList.map(() => emptyStats());

	for (const category of categories) {
		for (const basePath of getCategoryBasePaths(category)) {
			collectAgeBuckets(basePath, cutoffs, buckets);
		}
	}

	return buckets;
}

/**
 * 按时间删除数据：删除所有 mtime 早于 `days` 天的文件。
 * @param days 天数阈值（7/15/30/90 等）
 * @param categories 需要清理的分类
 */
export function deleteOlderThan(
	days: number,
	categories: readonly CleanupCategoryId[] = ALL_CLEANUP_CATEGORY_IDS,
): CleanupDeleteResult {
	const cutoff = resolveCutoff(days);
	const result = createEmptyResult();

	for (const category of categories) {
		for (const basePath of getCategoryBasePaths(category)) {
			deleteOlderThanInPath(basePath, cutoff, result, false);
		}
	}

	return result;
}
