/**
 * Sub-Agent Session Store
 *
 * 会话级子代理上下文存储：保存每个已执行子代理的完整对话历史，
 * 使主流程可以在同一会话中"重新激活"已完成的子代理并继承其上下文。
 *
 * 典型场景：子代理第一次执行结果不理想，主流程通过 agent_session_continue
 * 发送修改意见，子代理带着原有上下文继续工作（而不是从零开始重跑）。
 */
import type {ChatMessage} from '../../api/chat.js';

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

class SubAgentSessionStore {
	private records: Map<string, SubAgentSessionRecord> = new Map();

	save(record: SubAgentSessionRecord): void {
		this.records.set(record.key, record);
		this.enforceLimits(record.sessionId);
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
			if (
				!latest ||
				record.updatedAt.getTime() > latest.updatedAt.getTime()
			) {
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
				.sort(
					(a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
				);
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
