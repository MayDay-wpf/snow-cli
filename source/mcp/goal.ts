/**
 * Goal MCP 工具 - 暴露给模型用于状态转换
 *
 * 设计约束：
 * - 模型只能将目标标记为完成（achieved/unmet），不能 pause/resume/调整预算。
 * - pause/resume/clear/budget 由用户通过 /goal 指令显式触发。
 * - 若没有活跃目标，调用此工具会返回错误，提示模型不要凭空标记。
 */
import type {MCPTool} from '../utils/execution/mcpToolsManager.js';

export const mcpTools: MCPTool[] = [
	{
		type: 'function',
		function: {
			name: 'goal-update_goal',
			description:
				'Update the status of the currently active goal. Call this ONLY when you have audited actual files/outputs and confirmed: (1) the objective is fully achieved -> status="achieved", or (2) the objective cannot be achieved -> status="unmet". The model MUST NOT use this tool to pause/resume goals — that is reserved for the user. If no goal is active, this call will fail; do NOT invent a goal. Always provide a short, concrete explanation describing the evidence supporting your status decision.',
			parameters: {
				type: 'object',
				properties: {
					status: {
						type: 'string',
						enum: ['achieved', 'unmet'],
						description:
							'New status for the active goal. "achieved" means the objective is fully complete (verified by inspecting real files/outputs/tests). "unmet" means the goal cannot proceed without user input or external resolution. Do NOT use "achieved" based on proxy signals alone (e.g. tests pass != objective met).',
					},
					explanation: {
						type: 'string',
						description:
							'Concise, evidence-based justification (1-3 sentences). For "achieved": cite which deliverables were verified and how. For "unmet": cite the blocker, file path, or contradiction.',
					},
				},
				required: ['status', 'explanation'],
			},
		},
	},
];

/**
 * 执行 goal-update_goal 工具。由 mcpToolsManager.executeMCPTool 调度。
 */
export async function executeGoalTool(
	actualToolName: string,
	args: any,
): Promise<string> {
	const {goalManager} = await import('../utils/task/goalManager.js');

	if (actualToolName !== 'update_goal') {
		throw new Error(`Unknown goal tool: ${actualToolName}`);
	}

	const status = args?.status;
	const explanation =
		typeof args?.explanation === 'string' ? args.explanation : '';

	if (status !== 'achieved' && status !== 'unmet') {
		throw new Error(
			`goal-update_goal requires status="achieved" or status="unmet". Got: ${JSON.stringify(status)}`,
		);
	}

	const updated = await goalManager.modelUpdateGoal({status, explanation});
	if (!updated) {
		throw new Error(
			'No active goal to update. Use /goal <objective> to create one first. Do NOT invent a goal.',
		);
	}

	return JSON.stringify(
		{
			ok: true,
			id: updated.id,
			status: updated.status,
			runCount: updated.runCount,
			tokensUsed: updated.tokensUsed,
			tokenBudget: updated.tokenBudget,
			explanation: updated.lastExplanation || explanation,
			message: `Goal ${updated.id} marked as ${updated.status}. Loop will not auto-continue.`,
		},
		null,
		2,
	);
}
