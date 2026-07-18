/**
 * Goal Manager - /goal 指令的 Snow CLI 实现
 *
 * 核心思想（Ralph Loop）：为当前会话绑定一个持久化目标。
 * - 当目标为 pursuing 状态时，AI 每完成一轮回复后，会自动注入续接提示词（continuation.md）
 *   驱动下一轮，直到模型调用 update_goal 标记 achieved/unmet 或 token 预算耗尽。
 * - 用户可以 pause / resume / clear。
 * - 仅当存在活跃目标且模型未自行调用 update_goal 时才会续接。
 * - 模型只能将目标标记完成（achieved/unmet），不能 pause/resume/调整预算。
 *
 * 持久化路径: ~/.snow/goals/<projectId>/<sessionId>.json
 * 状态机:
 *   none -> pursuing (创建)
 *   pursuing -> paused / achieved / unmet / budget-limited
 *   paused -> pursuing (resume)
 *   * -> none (clear)
 */
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {randomUUID} from 'crypto';
import {sessionManager} from '../session/sessionManager.js';
import {getDefaultGoalTokenBudget} from '../config/unifiedSettings.js';

export type GoalStatus =
	| 'pursuing'
	| 'paused'
	| 'achieved'
	| 'unmet'
	| 'budget-limited';

export interface GoalRecord {
	id: string;
	sessionId: string;
	objective: string;
	status: GoalStatus;
	tokenBudget?: number;
	tokensUsed: number;
	runCount: number;
	createdAt: number;
	updatedAt: number;
	lastExplanation?: string;
	lastError?: string;
	pendingContinuation: boolean;
}

export interface GoalStatusUpdate {
	status: 'achieved' | 'unmet';
	explanation?: string;
}

function safeJsonParse<T>(content: string): T | null {
	try {
		return JSON.parse(content) as T;
	} catch {
		return null;
	}
}

/**
 * Goal 状态管理器（单例）。
 * - 内存缓存当前会话的目标，避免每次都读盘。
 * - 任何写操作都会同步落盘并广播给监听者。
 */
class GoalManager {
	private cache: Map<string, GoalRecord> = new Map();
	private listeners: Set<(goal: GoalRecord | null) => void> = new Set();

	private getGoalDir(): string {
		const projectId = sessionManager.getProjectId();
		return path.join(os.homedir(), '.snow', 'goals', projectId);
	}

	private getGoalPath(sessionId: string): string {
		return path.join(this.getGoalDir(), `${sessionId}.json`);
	}

	private async ensureDir(): Promise<void> {
		try {
			await fs.mkdir(this.getGoalDir(), {recursive: true});
		} catch {
			// 忽略已存在错误
		}
	}

	subscribe(cb: (goal: GoalRecord | null) => void): () => void {
		this.listeners.add(cb);
		return () => {
			this.listeners.delete(cb);
		};
	}

	private notify(goal: GoalRecord | null): void {
		for (const cb of this.listeners) {
			try {
				cb(goal);
			} catch {
				// 忽略监听器异常，避免拖累主流程
			}
		}
	}

	/**
	 * 加载当前会话的目标。优先用缓存，未命中则读取文件。
	 */
	async loadCurrentGoal(): Promise<GoalRecord | null> {
		const session = sessionManager.getCurrentSession();
		if (!session) return null;
		const sessionId = session.id;
		if (this.cache.has(sessionId)) return this.cache.get(sessionId)!;

		try {
			const content = await fs.readFile(this.getGoalPath(sessionId), 'utf-8');
			const parsed = safeJsonParse<GoalRecord>(content);
			if (parsed && parsed.sessionId === sessionId) {
				this.cache.set(sessionId, parsed);
				return parsed;
			}
		} catch {
			// 文件不存在或损坏，视为没有目标
		}
		return null;
	}

	/**
	 * 同步获取当前会话目标（仅用于不能 await 的场景，比如热路径检查）。
	 * 若尚未加载，则返回 null；调用方应在合适时机先 awaitloadCurrentGoal()。
	 */
	getCurrentGoalSync(): GoalRecord | null {
		const session = sessionManager.getCurrentSession();
		if (!session) return null;
		return this.cache.get(session.id) || null;
	}

	private async persist(goal: GoalRecord): Promise<void> {
		await this.ensureDir();
		const goalPath = this.getGoalPath(goal.sessionId);
		await fs.writeFile(goalPath, JSON.stringify(goal, null, 2), 'utf-8');
		this.cache.set(goal.sessionId, goal);
		this.notify(goal);
	}

	/**
	 * 创建新目标。若已存在活跃目标则报错（需先 clear）。
	 *
	 * 注意：Snow CLI 的 session 是惰性创建的（用户首次发送消息时才建），
	 * 而 /goal 是指令路径，不会经过 handleMessageSubmit。所以这里需要兜底
	 * 自行调用 createNewSession，否则刚进入聊天就敲 /goal 会拿到 null session。
	 */
	async createGoal(
		objective: string,
		tokenBudget?: number,
	): Promise<GoalRecord> {
		let session = sessionManager.getCurrentSession();
		if (!session) {
			session = await sessionManager.createNewSession();
		}
		const existing = await this.loadCurrentGoal();
		if (existing && existing.status === 'pursuing') {
			throw new Error(
				`A goal is already pursuing (id=${existing.id}). Use /goal clear first.`,
			);
		}
		if (existing && existing.status === 'paused') {
			throw new Error(
				`A paused goal exists (id=${existing.id}). Use /goal resume or /goal clear first.`,
			);
		}

		const trimmed = objective.trim();
		if (!trimmed) {
			throw new Error('Goal objective cannot be empty.');
		}

		const now = Date.now();
		const goal: GoalRecord = {
			id: randomUUID().replace(/-/g, '').slice(0, 8),
			sessionId: session.id,
			objective: trimmed,
			status: 'pursuing',
			tokenBudget: tokenBudget ?? getDefaultGoalTokenBudget(),
			tokensUsed: 0,
			runCount: 0,
			createdAt: now,
			updatedAt: now,
			// 创建即标记需要续接，让第一轮 processMessage 入口立刻消费 continuation prompt，
			// 否则用户必须自己再发一条消息才能启动 Ralph Loop，体验割裂。
			pendingContinuation: true,
		};
		await this.persist(goal);
		// 标记会话级 hasGoal=true，让 mcpToolsManager 在本会话注册 goal- 工具。
		// 必须等 persist 之后再做，避免 goal 文件还没落盘就先暴露工具给模型。
		await sessionManager.setSessionGoalFlag(session.id, true);
		// 配置 hash 依赖会话 hasGoal，需要让缓存失效以强制重建工具列表。
		try {
			const {clearMCPToolsCache} = await import(
				'../execution/mcpToolsManager.js'
			);
			clearMCPToolsCache();
		} catch {
			// ignore: 仅性能优化，下一次缓存校验会自动重建
		}
		return goal;
	}

	async pauseGoal(): Promise<GoalRecord | null> {
		const goal = await this.loadCurrentGoal();
		if (!goal) return null;
		if (goal.status !== 'pursuing') return goal;
		goal.status = 'paused';
		goal.updatedAt = Date.now();
		goal.pendingContinuation = false;
		await this.persist(goal);
		return goal;
	}

	async resumeGoal(): Promise<GoalRecord | null> {
		const goal = await this.loadCurrentGoal();
		if (!goal) return null;
		if (goal.status !== 'paused') return goal;
		goal.status = 'pursuing';
		goal.updatedAt = Date.now();
		goal.pendingContinuation = true; // 立即触发下一轮续接
		await this.persist(goal);
		return goal;
	}

	async clearGoal(): Promise<GoalRecord | null> {
		const session = sessionManager.getCurrentSession();
		if (!session) return null;
		const goal = await this.loadCurrentGoal();
		if (!goal) return null;
		const goalPath = this.getGoalPath(session.id);
		try {
			await fs.unlink(goalPath);
		} catch {
			// 文件可能不存在，忽略
		}
		this.cache.delete(session.id);
		this.notify(null);
		// 撤销会话级 hasGoal 标记，下一次 refreshToolsCache 时 goal- 工具会消失
		await sessionManager.setSessionGoalFlag(session.id, false);
		try {
			const {clearMCPToolsCache} = await import(
				'../execution/mcpToolsManager.js'
			);
			clearMCPToolsCache();
		} catch {
			// ignore
		}
		return goal;
	}

	/**
	 * 模型通过 update_goal 工具调用此方法标记完成。
	 * 仅允许从 pursuing 进入 achieved / unmet（用户专属：pause/resume/budget）。
	 */
	async modelUpdateGoal(update: GoalStatusUpdate): Promise<GoalRecord | null> {
		const goal = await this.loadCurrentGoal();
		if (!goal) return null;
		if (goal.status !== 'pursuing') {
			throw new Error(
				`Cannot update goal: status is ${goal.status}, only "pursuing" can be marked complete by the model.`,
			);
		}
		if (update.status !== 'achieved' && update.status !== 'unmet') {
			throw new Error(
				`Invalid status "${update.status}". Model may only set: achieved | unmet.`,
			);
		}
		goal.status = update.status;
		goal.updatedAt = Date.now();
		goal.pendingContinuation = false;
		if (update.explanation) {
			goal.lastExplanation = update.explanation;
		}
		await this.persist(goal);
		// 模型标记 achieved/unmet 后，本会话不再需要 goal- 工具——
		// 撤销 hasGoal 标记，下一次 refreshToolsCache 会移除该工具，避免模型
		// 在已结束的目标上继续误调用 goal-update_goal。
		await sessionManager.setSessionGoalFlag(goal.sessionId, false);
		try {
			const {clearMCPToolsCache} = await import(
				'../execution/mcpToolsManager.js'
			);
			clearMCPToolsCache();
		} catch {
			// ignore
		}
		return goal;
	}

	/**
	 * 加载任意 sessionId 对应的 goal（不依赖当前 session）。
	 * 用于 /goal resume 列表面板和 setSessionGoalFlag 时按 id 查询，
	 * 与 loadCurrentGoal 的区别：不会更新 this.cache（避免污染当前会话缓存）。
	 */
	async loadGoalForSession(sessionId: string): Promise<GoalRecord | null> {
		// 命中缓存直接返回
		if (this.cache.has(sessionId)) return this.cache.get(sessionId)!;
		try {
			const content = await fs.readFile(this.getGoalPath(sessionId), 'utf-8');
			const parsed = safeJsonParse<GoalRecord>(content);
			if (parsed && parsed.sessionId === sessionId) {
				return parsed;
			}
		} catch {
			// 文件不存在或损坏
		}
		return null;
	}

	/**
	 * /goal resume <sessionId> 的实现：定位到指定会话的 goal 并把状态切回 pursuing。
	 * 调用方需要在调用前确认 sessionManager 已切换到该 sessionId（loadSession），
	 * 因为本方法假设 sessionManager.getCurrentSession().id === sessionId 后才生效。
	 */
	async resumeGoalForSession(sessionId: string): Promise<GoalRecord | null> {
		const goal = await this.loadGoalForSession(sessionId);
		if (!goal) return null;
		// pursuing / paused / budget-limited 都允许恢复；achieved / unmet 拦截
		if (
			goal.status !== 'pursuing' &&
			goal.status !== 'paused' &&
			goal.status !== 'budget-limited'
		) {
			return goal;
		}
		goal.status = 'pursuing';
		goal.updatedAt = Date.now();
		goal.pendingContinuation = true; // 立即触发下一轮续接
		await this.persist(goal);
		// 重新点亮 hasGoal 标记（如果之前被错误地关掉）
		await sessionManager.setSessionGoalFlag(sessionId, true);
		try {
			const {clearMCPToolsCache} = await import(
				'../execution/mcpToolsManager.js'
			);
			clearMCPToolsCache();
		} catch {
			// ignore
		}
		return goal;
	}

	/**
	 * 累计 token 使用量；超出预算自动转为 budget-limited 并清空续接标记。
	 * 返回是否触发了预算耗尽。
	 */
	async accrueTokens(deltaTokens: number): Promise<{
		exceeded: boolean;
		goal: GoalRecord | null;
	}> {
		const goal = await this.loadCurrentGoal();
		if (!goal || goal.status !== 'pursuing') {
			return {exceeded: false, goal};
		}
		if (deltaTokens <= 0) {
			return {exceeded: false, goal};
		}
		goal.tokensUsed += deltaTokens;
		goal.updatedAt = Date.now();
		const budget = goal.tokenBudget ?? getDefaultGoalTokenBudget();
		const exceeded = goal.tokensUsed >= budget;
		if (exceeded) {
			goal.status = 'budget-limited';
			goal.pendingContinuation = true; // 触发一次 budget_limit 收尾轮次
		}
		await this.persist(goal);
		return {exceeded, goal};
	}

	/**
	 * 标记下一轮需要续接（在一次 AI 回答完成时被调用）。
	 */
	async markPendingContinuation(): Promise<GoalRecord | null> {
		const goal = await this.loadCurrentGoal();
		if (!goal) return null;
		if (goal.status !== 'pursuing') return goal;
		goal.runCount += 1;
		goal.pendingContinuation = true;
		goal.updatedAt = Date.now();
		await this.persist(goal);
		return goal;
	}

	/**
	 * 消费“待续接”标记。返回应注入的提示词；若无续接需求则返回 null。
	 * - pursuing + pendingContinuation -> continuation prompt
	 * - budget-limited + pendingContinuation -> budget_limit prompt（仅一次）
	 */
	async consumePendingContinuation(): Promise<string | null> {
		const goal = await this.loadCurrentGoal();
		if (!goal) return null;
		if (!goal.pendingContinuation) return null;

		if (goal.status === 'pursuing') {
			goal.pendingContinuation = false;
			goal.updatedAt = Date.now();
			await this.persist(goal);
			return buildContinuationPrompt(goal);
		}
		if (goal.status === 'budget-limited') {
			goal.pendingContinuation = false;
			goal.updatedAt = Date.now();
			await this.persist(goal);
			return buildBudgetLimitPrompt(goal);
		}
		// paused / achieved / unmet 不续接
		goal.pendingContinuation = false;
		await this.persist(goal);
		return null;
	}

	/**
	 * 用于命令面板/状态栏的轻量摘要。
	 */
	formatSummary(goal: GoalRecord): string {
		const budget = goal.tokenBudget ?? getDefaultGoalTokenBudget();
		const usedPct =
			budget > 0 ? Math.min(100, (goal.tokensUsed / budget) * 100) : 0;
		const lines = [
			`id: ${goal.id}`,
			`status: ${goal.status}`,
			`objective: ${goal.objective}`,
			`runs: ${goal.runCount}`,
			`tokens: ${goal.tokensUsed} / ${budget} (${usedPct.toFixed(1)}%)`,
			`createdAt: ${new Date(goal.createdAt).toLocaleString()}`,
			`updatedAt: ${new Date(goal.updatedAt).toLocaleString()}`,
		];
		if (goal.lastExplanation) {
			lines.push(`explanation: ${goal.lastExplanation}`);
		}
		if (goal.lastError) {
			lines.push(`lastError: ${goal.lastError}`);
		}
		return lines.join('\n');
	}

	/**
	 * 上下文压缩专用：把旧 sessionId 的 goal 记录迁移到新 sessionId。
	 *
	 * 背景：executeContextCompression 会创建一个全新的 sessionId（用于保留压缩前
	 * 的完整快照），但 goal 文件是按 sessionId 落盘的：~/.snow/goals/<projectId>/<sessionId>.json。
	 * 如果不迁移，压缩后切到新会话时 loadCurrentGoal 读不到任何文件，Ralph Loop
	 * 当场死掉、续接 prompt 也不会再注入，用户的目标原文（goal.objective）也跟着丢。
	 *
	 * 行为：
	 * - 读旧 path 的 GoalRecord -> 修改 sessionId 字段 -> 写到新 path -> 同步缓存。
	 * - 旧 goal 文件保留不删，方便回滚到压缩前快照时仍能用。
	 * - 旧缓存项主动清掉，避免后续 loadCurrentGoal/loadGoalForSession 命中错误 sessionId。
	 * - 写完后通知监听者（状态栏/命令面板会立刻看到新会话已绑定 goal）。
	 *
	 * @returns 迁移后的 GoalRecord；如果旧 sessionId 没有 goal 则返回 null。
	 */
	async migrateGoalToSession(
		oldSessionId: string,
		newSessionId: string,
	): Promise<GoalRecord | null> {
		if (!oldSessionId || !newSessionId || oldSessionId === newSessionId) {
			return null;
		}
		const original = await this.loadGoalForSession(oldSessionId);
		if (!original) return null;

		const migrated: GoalRecord = {
			...original,
			sessionId: newSessionId,
			updatedAt: Date.now(),
		};
		// 直接走 persist：会 ensureDir、写新文件、更新缓存并 notify。
		await this.persist(migrated);
		// 把旧 sessionId 的缓存清掉，避免下次 loadCurrentGoal 命中旧条目。
		this.cache.delete(oldSessionId);
		return migrated;
	}
}

/**
 * 续接提示词
 * 强调：
 * 1) 完整维护 todolist（goal 模式的基本要求 —— 拆解、跟踪、收敛）；
 * 2) 重述目标为具体可验证交付物；
 * 3) 构建审计清单；
 * 4) 必须检视真实文件/输出，不接受代理信号；
 * 5) 达成时必须调用 goal-update_goal 工具显式标记 achieved。
 */
function buildContinuationPrompt(goal: GoalRecord): string {
	const remaining =
		(goal.tokenBudget ?? getDefaultGoalTokenBudget()) - goal.tokensUsed;
	return [
		'[GOAL CONTINUATION]',
		`Active goal (id=${goal.id}, run #${goal.runCount + 1}):`,
		`"${goal.objective}"`,
		'',
		'MANDATORY — TODOLIST DISCIPLINE (basic requirement of goal mode):',
		'- Maintain a COMPLETE, up-to-date todolist for this goal using the `todo-manage` tool.',
		'- FIRST action every turn: call `todo-manage` with action="get" to inspect the current list. If empty or stale, immediately decompose the objective into concrete actionable items via action="add" (batch the full plan in one call).',
		'- Update item status IMMEDIATELY after each step is verified: action="update" with status="inProgress" when you start and status="completed" when you finish — do NOT batch-update at the end of the turn.',
		'- Delete obsolete or superseded items via action="delete" so the list stays focused; refine wording via action="update" content when scope clarifies.',
		'- The todolist must remain a faithful mirror of progress toward the objective: every remaining deliverable has an item, every completed deliverable is marked completed.',
		'',
		'Instructions for this turn:',
		'1. Sync the todolist first (see TODOLIST DISCIPLINE above) before doing any other work.',
		'2. Restate the objective as concrete, testable deliverables (and reflect them as todolist items).',
		'3. Build an audit checklist mapping each requirement to verification evidence.',
		'4. Inspect actual files, outputs, and test results — DO NOT infer from proxy signals (e.g. "tests pass" alone is not proof).',
		'5. If the audit confirms the objective is fully achieved, ensure every todolist item is marked completed, then you MUST call the tool `goal-update_goal` with status="achieved" and a short explanation.',
		'6. If the goal cannot be achieved (blocked, requires user input, contradictory requirements), record the blocker as a todolist item and call `goal-update_goal` with status="unmet" and explain why.',
		'7. Otherwise, execute the next concrete step toward the objective (updating todolist status as you go) and the loop will re-prompt you next turn.',
		'',
		`Token budget: ~${remaining} tokens remaining (used ${goal.tokensUsed} / ${
			goal.tokenBudget ?? getDefaultGoalTokenBudget()
		}). Prefer small, verifiable steps.`,
		'',
		'CRITICAL: Do not declare completion by chat text alone. The loop only stops when you call `goal-update_goal`. A stale or missing todolist is itself a violation of goal-mode requirements.',
	].join('\n');
}

/**
 * 预算耗尽提示词
 * 要求模型优雅收尾：不开启新任务、总结进展、给出下一步、不虚假声明完成。
 * 同样要求把 todolist 同步到最终状态，方便用户/下个会话接管。
 */
function buildBudgetLimitPrompt(goal: GoalRecord): string {
	return [
		'[GOAL BUDGET LIMIT REACHED]',
		`Active goal (id=${goal.id}): "${goal.objective}"`,
		`Token budget exhausted: ${goal.tokensUsed} / ${goal.tokenBudget}.`,
		'',
		'This is your FINAL turn for this goal. You MUST:',
		'1. NOT start any new substantive work.',
		'2. Sync the todolist via `todo-manage` to its final state: mark completed items as "completed", leave remaining items as "pending" with clear wording so a human or new session can pick them up. Do NOT delete unfinished items.',
		'3. Summarize useful progress made so far.',
		'4. Identify remaining work and any blockers (these should also appear as pending todolist items).',
		'5. Provide a clear next step (file, function, command) that a human or new session can pick up.',
		'6. DO NOT falsely call `goal-update_goal` with status="achieved" just because the budget is exhausted. Only mark "achieved" if the audit truly confirms completion.',
		'',
		'After this turn, the goal will automatically remain in "budget-limited" state. The user can clear it or raise the budget and resume.',
	].join('\n');
}

export const goalManager = new GoalManager();
