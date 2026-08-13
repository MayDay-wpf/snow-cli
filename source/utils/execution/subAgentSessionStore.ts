/**
 * Sub-Agent Session Store
 *
 * 会话级子代理上下文存储：保存每个已执行子代理的完整对话历史，
 * 使主流程可以在同一会话中"重新激活"已完成的子代理并继承其上下文。
 *
 * 典型场景：子代理第一次执行结果不理想，主流程通过 agent_session_continue
 * 发送修改意见，子代理带着原有上下文继续工作（而不是从零开始重跑）。
 */
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type {ChatMessage} from '../../api/chat.js';
import {logger} from '../core/logger.js';

export type SubAgentSessionStatus =
	| 'running'
	| 'completed'
	| 'failed'
	| 'aborted';

export interface SubAgentSessionRecord {
	/** 逻辑会话唯一键（原始 instanceId 或自动生成键） */
	key: string;
	/** 所属 Snow 会话 ID */
	sessionId?: string;
	agentId: string;
	agentName: string;
	/** 原始任务提示词 */
	prompt: string;
	status: SubAgentSessionStatus;
	/** 完整对话历史（续接后更新为最新状态） */
	messages: ChatMessage[];
	/** 最后一次执行的结果文本 */
	lastResult?: string;
	lastError?: string;
	/** 该逻辑会话已被续接的次数 */
	resumeCount: number;
	startedAt: Date;
	updatedAt: Date;
}

const MAX_PER_SESSION = 20;
const MAX_TOTAL = 200;
/** 旧版存储根目录（兼容读取历史数据）：~/.snow/subagents/ */
const LEGACY_STORAGE_ROOT = path.join(os.homedir(), '.snow', 'subagents');

class SubAgentSessionStore {
	private records: Map<string, SubAgentSessionRecord> = new Map();
	/** 已从磁盘加载过的会话 ID（避免重复读盘） */
	private loadedSessionIds = new Set<string>();
	/** 每会话串行写盘队列，避免并发 writeFile 覆盖 */
	private persistQueues = new Map<string, Promise<void>>();

	save(record: SubAgentSessionRecord): void {
		this.records.set(record.key, record);
		this.enforceLimits(record.sessionId);
		if (record.sessionId) {
			this.loadedSessionIds.add(record.sessionId);
			this.persist(record.sessionId).catch(error => {
				logger.error('Failed to persist sub-agent sessions:', {
					sessionId: record.sessionId,
					error: error instanceof Error ? error.message : String(error),
				});
			});
		}
	}

	/**
	 * 确保某会话的记录已从磁盘加载到内存（懒加载 + 缓存）。
	 * CLI 重启后内存为空，查询/续接子代理会话前必须先调用本方法。
	 */
	async ensureLoaded(sessionId?: string): Promise<void> {
		if (!sessionId || this.loadedSessionIds.has(sessionId)) return;
		this.loadedSessionIds.add(sessionId);
		const filePath = await this.findSessionFile(sessionId);
		if (!filePath) return;
		try {
			const data = await fs.readFile(filePath, 'utf-8');
			const rawRecords: unknown[] = JSON.parse(data);
			for (const raw of rawRecords) {
				if (!raw || typeof raw !== 'object') continue;
				const record = raw as Partial<SubAgentSessionRecord>;
				if (typeof record.key !== 'string') continue;
				this.records.set(record.key, this.normalize(record));
			}
		} catch {
			// 文件损坏：视为无记录，忽略
		}
	}

	/** 删除某会话的所有子代理记录（内存 + 磁盘），主会话删除时联动调用 */
	async deleteForSession(sessionId: string): Promise<void> {
		for (const [key, record] of this.records) {
			if (record.sessionId === sessionId) this.records.delete(key);
		}
		this.loadedSessionIds.delete(sessionId);
		// 删除新路径文件（含历史日期目录中的）
		const filePath = await this.findSessionFile(sessionId);
		if (filePath) {
			try {
				await fs.unlink(filePath);
			} catch {
				// 文件不存在则忽略
			}
		}
		// 删除旧版路径文件（兼容历史版本写盘的数据）
		try {
			await fs.unlink(this.getLegacySessionFilePath(sessionId));
		} catch {
			// 文件不存在则忽略
		}
	}

	get(key: string): SubAgentSessionRecord | undefined {
		const record = this.records.get(key);
		if (!record) return undefined;
		return this.clone(record);
	}

	/** 查找某 agentId 在会话中最新的记录（用于按 agent_id 续接） */
	findLatestByAgentId(
		agentId: string,
		sessionId?: string,
	): SubAgentSessionRecord | undefined {
		let latest: SubAgentSessionRecord | undefined;
		for (const record of this.records.values()) {
			if (record.agentId !== agentId) continue;
			if (sessionId && record.sessionId !== sessionId) continue;
			if (!latest || record.updatedAt.getTime() > latest.updatedAt.getTime()) {
				latest = record;
			}
		}
		return latest ? this.clone(latest) : undefined;
	}

	/** 列出会话内所有记录（按更新时间倒序） */
	list(sessionId?: string): SubAgentSessionRecord[] {
		return Array.from(this.records.values())
			.filter(r => !sessionId || r.sessionId === sessionId)
			.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
			.map(r => this.clone(r));
	}

	remove(key: string): boolean {
		return this.records.delete(key);
	}

	clear(): void {
		this.records.clear();
		this.loadedSessionIds.clear();
	}

	/** 旧版存储路径（兼容历史版本写盘的数据） */
	private getLegacySessionFilePath(sessionId: string): string {
		return path.join(LEGACY_STORAGE_ROOT, `${sessionId}.json`);
	}

	/**
	 * 获取当前项目当天子代理存储目录。
	 * 新路径结构: ~/.snow/sessions/<项目ID>/<YYYYMMDD>/subagent/
	 * 与主会话文件同一目录树，按项目与日期归档。
	 */
	private async getStorageDir(): Promise<string | undefined> {
		try {
			const {sessionManager} = await import('../session/sessionManager.js');
			return sessionManager.getSubAgentSessionsDir();
		} catch {
			return undefined;
		}
	}

	/**
	 * 查找会话文件：优先当天目录，其次遍历该项目历史日期目录（跨天恢复），
	 * 最后兜底旧版路径 ~/.snow/subagents/。
	 */
	private async findSessionFile(
		sessionId: string,
	): Promise<string | undefined> {
		// 1. 当天目录
		const dir = await this.getStorageDir();
		if (dir) {
			const todayPath = path.join(dir, `${sessionId}.json`);
			if (await this.exists(todayPath)) return todayPath;
		}
		// 2. 历史日期目录（跨天重启后恢复）
		if (dir) {
			const projectDir = path.dirname(path.dirname(dir)); // .../<项目ID>
			try {
				const entries = await fs.readdir(projectDir);
				for (const entry of entries) {
					// 日期目录格式与 formatDateCompact 一致（YYYYMMDD）
					if (!/^\d{8}$/.test(entry)) continue;
					const candidate = path.join(
						projectDir,
						entry,
						'subagent',
						`${sessionId}.json`,
					);
					if (await this.exists(candidate)) return candidate;
				}
			} catch {
				// 项目目录不存在
			}
		}
		// 3. 旧版路径（兼容历史版本写盘的数据）
		const legacyPath = this.getLegacySessionFilePath(sessionId);
		if (await this.exists(legacyPath)) return legacyPath;
		return undefined;
	}

	private async exists(filePath: string): Promise<boolean> {
		try {
			await fs.access(filePath);
			return true;
		} catch {
			return false;
		}
	}

	/** 串行化同一会话的写盘，防止并发 writeFile 互相覆盖 */
	private persist(sessionId: string): Promise<void> {
		const previous = this.persistQueues.get(sessionId) ?? Promise.resolve();
		const next = previous
			.catch(() => undefined)
			.then(async () => {
				const sessionRecords = Array.from(this.records.values()).filter(
					r => r.sessionId === sessionId,
				);
				const dir = await this.getStorageDir();
				if (!dir) return;
				await fs.mkdir(dir, {recursive: true});
				await fs.writeFile(
					path.join(dir, `${sessionId}.json`),
					JSON.stringify(sessionRecords, null, 2),
				);
			});
		this.persistQueues.set(sessionId, next);
		return next;
	}

	/** 反序列化：把磁盘上的 ISO 时间字符串还原为 Date，并补齐缺失字段 */
	private normalize(
		raw: Partial<SubAgentSessionRecord>,
	): SubAgentSessionRecord {
		return {
			key: raw.key!,
			sessionId: raw.sessionId,
			agentId: raw.agentId ?? '',
			agentName: raw.agentName ?? raw.agentId ?? '',
			prompt: raw.prompt ?? '',
			status: raw.status ?? 'completed',
			messages: Array.isArray(raw.messages) ? raw.messages : [],
			lastResult: raw.lastResult,
			lastError: raw.lastError,
			resumeCount: typeof raw.resumeCount === 'number' ? raw.resumeCount : 0,
			startedAt: new Date(raw.startedAt ?? Date.now()),
			updatedAt: new Date(raw.updatedAt ?? Date.now()),
		};
	}

	private clone(record: SubAgentSessionRecord): SubAgentSessionRecord {
		return {...record, messages: [...record.messages]};
	}

	/**
	 * 淘汰策略：每会话最多 MAX_PER_SESSION 条，全局最多 MAX_TOTAL 条，
	 * 超出时移除最久未更新的记录，避免内存无限增长。
	 */
	private enforceLimits(currentSessionId?: string): void {
		if (currentSessionId) {
			const sessionRecords = Array.from(this.records.values())
				.filter(r => r.sessionId === currentSessionId)
				.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
			while (sessionRecords.length > MAX_PER_SESSION) {
				const oldest = sessionRecords.pop();
				if (oldest) this.records.delete(oldest.key);
			}
		}

		if (this.records.size <= MAX_TOTAL) return;

		const sorted = Array.from(this.records.values()).sort(
			(a, b) => a.updatedAt.getTime() - b.updatedAt.getTime(),
		);
		while (this.records.size > MAX_TOTAL) {
			const oldest = sorted.shift();
			if (oldest) this.records.delete(oldest.key);
		}
	}
}

export const subAgentSessionStore = new SubAgentSessionStore();
