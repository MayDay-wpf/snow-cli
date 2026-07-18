/**
 * /goal 指令 - Ralph Loop 的 Snow CLI 实现
 *
 * 支持的子命令:
 *   /goal <objective>           创建并启动新目标
 *   /goal <objective> --budget=N 设置 token 预算，单位 M（默认 2，即 2,000,000 tokens）
 *   /goal pause                 暂停当前目标
 *   /goal resume                恢复已暂停的目标（立即触发一轮续接）
 *   /goal resume <sessionId>    恢复指定会话的目标
 *   /goal clear                 清除当前目标
 *   /goal status                显示当前目标摘要
 *
 * 设计要点:
 * - 不要把 objective 写成模糊的“清理代码”，要写成可验证的契约。
 * - 创建目标后，AI 后续每轮回答完成都会自动续接，直到模型调用
 *   `goal-update_goal` 工具标记 achieved/unmet 或预算耗尽。
 */
import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {goalManager} from '../task/goalManager.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';

interface ParsedArgs {
	subcommand?: 'pause' | 'resume' | 'clear' | 'status';
	/** /goal resume <sessionId> 时携带的目标会话 id */
	resumeSessionId?: string;
	objective?: string;
	budget?: number;
}

const SUBCOMMANDS = new Set(['pause', 'resume', 'clear', 'status']);

function parseArgs(rawArgs: string): ParsedArgs {
	const trimmed = rawArgs.trim();
	if (!trimmed) return {};

	// 提取 --budget=N 或 --budget N，单位 M（百万 tokens），支持小数如 1.5
	let working = trimmed;
	let budget: number | undefined;
	const budgetMatch = working.match(/\s*--budget(?:=|\s+)(\d+(?:\.\d+)?)\s*/);
	if (budgetMatch && budgetMatch[1]) {
		const budgetM = Number.parseFloat(budgetMatch[1]);
		if (!Number.isNaN(budgetM) && budgetM > 0) {
			budget = Math.round(budgetM * 1_000_000);
		}
		working = working.replace(budgetMatch[0], ' ').trim();
	}

	if (!working) {
		return {budget};
	}

	// /goal resume <sessionId>：subcommand=resume 后面跟着会话 id
	// 用空白分割：第一个 token 必须 lower == 'resume'，其余作为 sessionId
	// （sessionId 通常是 uuid，不会含空格）
	const tokens = working.split(/\s+/);
	if (tokens.length >= 2 && tokens[0] && tokens[0].toLowerCase() === 'resume') {
		return {
			subcommand: 'resume',
			resumeSessionId: tokens.slice(1).join(' ').trim(),
			budget,
		};
	}

	// 子命令必须严格等于单个关键字（不包含其它内容），否则视为 objective。
	// 这样像 "/goal Pause the OAuth callback to investigate ..." 这类
	// 以子命令同名单词开头的长目标不会被误识别为 pause 子命令。
	const lower = working.toLowerCase();
	if (SUBCOMMANDS.has(lower)) {
		return {
			subcommand: lower as ParsedArgs['subcommand'],
			budget,
		};
	}

	return {objective: working, budget};
}

// 获取当前语言的 goal 翻译表，并提供安全回退到 en
function getGoalMessages() {
	const lang = getCurrentLanguage();
	const fallback = translations.en.commandPanel.commandOutput.goal;
	const current = translations[lang]?.commandPanel?.commandOutput?.goal;
	return {...fallback, ...(current || {})};
}

// 简单的 {placeholder} 模板替换
function format(template: string, params: Record<string, string>): string {
	return template.replace(/\{(\w+)\}/g, (_, key) =>
		key in params ? params[key]! : `{${key}}`,
	);
}

function formatBudget(budget: number | undefined): string {
	const m = getGoalMessages();
	if (!budget) return m.budgetUnlimited;
	if (budget >= 1_000_000)
		return format(m.budgetMillion, {value: (budget / 1_000_000).toFixed(1)});
	if (budget >= 1_000)
		return format(m.budgetThousand, {value: (budget / 1_000).toFixed(1)});
	return format(m.budgetTokens, {value: String(budget)});
}

registerCommand('goal', {
	execute: async (args?: string): Promise<CommandResult> => {
		const parsed = parseArgs(args || '');
		const m = getGoalMessages();

		// ───── /goal （无参数）等同于 /goal status ─────
		if (
			!parsed.subcommand &&
			!parsed.objective &&
			parsed.budget === undefined
		) {
			const goal = await goalManager.loadCurrentGoal();
			if (!goal) {
				return {
					success: true,
					message: [
						m.noActiveGoal,
						'',
						m.usageHeader,
						m.usageObjective,
						m.usageBudget,
						m.usagePause,
						m.usageResume,
						m.usageResumeSession,
						m.usageClear,
						m.usageStatus,
						'',
						m.tipHeader,
						m.tipGood,
						m.tipBad,
					].join('\n'),
				};
			}
			return {
				success: true,
				message: [m.currentGoal, '', goalManager.formatSummary(goal)].join(
					'\n',
				),
			};
		}

		// ───── /goal status ─────
		if (parsed.subcommand === 'status') {
			const goal = await goalManager.loadCurrentGoal();
			if (!goal) {
				return {success: true, message: m.noActiveGoalInSession};
			}
			return {
				success: true,
				message: [m.currentGoal, '', goalManager.formatSummary(goal)].join(
					'\n',
				),
			};
		}

		// ───── /goal pause ─────
		if (parsed.subcommand === 'pause') {
			const goal = await goalManager.pauseGoal();
			if (!goal) {
				return {success: false, message: m.noActiveGoalToPause};
			}
			return {
				success: true,
				message: format(m.pauseSuccess, {id: goal.id}),
			};
		}

		// ───── /goal resume / /goal resume <sessionId> ─────
		if (parsed.subcommand === 'resume') {
			// 情况 A：/goal resume <sessionId> —— 直接定位到指定会话，
			// 不在这里加载会话（commandExecutor 在主线程，不持有 UI hook），
			// 而是返回 resume action（沿用 /resume <id> 的链路）让 useCommandHandler
			// 调用 onResumeSessionById 完成 UI 切换；之后由 ChatScreen 的
			// handleGoalSessionPanelSelect 等价路径接管启动 Ralph Loop。
			//
			// 但 commandExecutor.CommandResult 的 'resume' action 只负责切会话，
			// 不会启动 loop。所以我们这里复用 startGoalLoop + sessionId 的组合不太干净。
			// 取而代之：让 useCommandHandler 在收到 resume + sessionId 时，
			// 先调 onResumeSessionById，再额外调用 goalManager.resumeGoalForSession + processMessage。
			// —— 但这个逻辑放到 useCommandHandler 维护比放 goal.ts 维护更合适，
			// 因此这里只返回 action=resume + sessionId + 标记 message，
			// useCommandHandler 检测到 message 含特殊标记后追加 goal 启动步骤。
			//
			// 为了避免引入新 action 类型造成接口爆炸，我们直接复用现有的
			// showGoalSessionPanel：当带 sessionId 时，useCommandHandler 会
			// 跳过弹面板、直接走 handleGoalSessionPanelSelect 同款逻辑。
			if (parsed.resumeSessionId) {
				return {
					success: true,
					action: 'showGoalSessionPanel',
					sessionId: parsed.resumeSessionId,
					message: format(m.resumingSession, {
						sessionId: parsed.resumeSessionId,
					}),
				};
			}

			// 情况 B：当前会话已经绑定了一个 paused goal —— 原有行为，原地恢复并启动循环
			const currentGoal = await goalManager.loadCurrentGoal();
			if (currentGoal && currentGoal.status === 'paused') {
				const goal = await goalManager.resumeGoal();
				if (!goal) {
					return {success: false, message: m.noGoalToResume};
				}
				if (goal.status !== 'pursuing') {
					return {
						success: false,
						message: format(m.cannotResumeStatus, {status: goal.status}),
					};
				}
				return {
					success: true,
					action: 'startGoalLoop',
					message: [format(m.resumeSuccess, {id: goal.id}), m.resumeHint].join(
						'\n',
					),
					prompt: goal.objective,
				};
			}

			// 情况 C：当前会话没有可恢复的 goal —— 弹出 goal 会话列表面板让用户挑
			// （通常用户在 chat 里运行 /goal resume 时其实想恢复别的会话的 goal）
			return {
				success: true,
				action: 'showGoalSessionPanel',
				message: m.openSessionPicker,
			};
		}

		// ───── /goal clear ─────
		if (parsed.subcommand === 'clear') {
			const goal = await goalManager.clearGoal();
			if (!goal) {
				return {success: false, message: m.noActiveGoalToClear};
			}
			return {
				success: true,
				message: format(m.clearSuccess, {id: goal.id}),
			};
		}

		// ───── /goal <objective> [--budget=N] ─────
		if (parsed.objective) {
			try {
				const goal = await goalManager.createGoal(
					parsed.objective,
					parsed.budget,
				);
				return {
					success: true,
					// 返回 startGoalLoop 让 useCommandHandler 立刻调用 processMessage
					// 启动第一轮。goalManager.createGoal 已把 pendingContinuation 置为 true，
					// processMessage 入口会消费 continuation prompt 作为本轮 AI 输入额外注入。
					action: 'startGoalLoop',
					// message 用于命令面板回显（command tree 节点）：显示 goal id + budget + 操作提示
					message: [
						format(m.created, {id: goal.id}),
						format(m.tokenBudget, {budget: formatBudget(goal.tokenBudget)}),
						m.createHint,
					].join('\n'),
					// prompt 用于作为本轮的"可见用户消息"内容（处理时还会拼接 continuation prompt）。
					// 这样用户在历史里能看到自己设的目标，双击 ESC 回滚也能定位到 /goal 这一条。
					prompt: goal.objective,
				};
			} catch (err) {
				return {
					success: false,
					message:
						err instanceof Error
							? format(m.createFailed, {error: err.message})
							: format(m.createFailed, {error: m.unknownError}),
				};
			}
		}

		// ───── 仅 --budget 不带 objective 是错误用法 ─────
		return {
			success: false,
			message: m.invalidUsage,
		};
	},
});

export default {};
