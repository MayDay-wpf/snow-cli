/**
 * Team Executor
 * Executes teammate sessions in an Agent Team.
 * Based on executeSubAgent but with key differences:
 * - Each teammate runs in its own Git worktree
 * - Full tool access (not restricted like subagents)
 * - Team-specific synthetic tools (message, task management)
 * - Team-aware context (task list, other teammates)
 */

import type {ChatMessage} from '../../api/chat.js';
import type {MCPTool} from './mcpToolsManager.js';
import {teamTracker} from './teamTracker.js';
import type {SubAgentMessage, TokenUsage} from './subAgentExecutor.js';

export interface TeammateExecutionOptions {
	onMessage?: (message: SubAgentMessage) => void;
	abortSignal?: AbortSignal;
	requestToolConfirmation?: (
		toolName: string,
		toolArgs: any,
	) => Promise<import('../../ui/components/tools/ToolConfirmation.js').ConfirmationResult>;
	isToolAutoApproved?: (toolName: string) => boolean;
	yoloMode?: boolean;
	addToAlwaysApproved?: (toolName: string) => void;
	requestUserQuestion?: (
		question: string,
		options: string[],
		multiSelect?: boolean,
	) => Promise<{selected: string | string[]; customInput?: string}>;
	requirePlanApproval?: boolean;
}

export interface TeammateExecutionResult {
	success: boolean;
	result: string;
	error?: string;
	usage?: TokenUsage;
}

export async function executeTeammate(
	memberId: string,
	memberName: string,
	prompt: string,
	worktreePath: string,
	teamName: string,
	role: string | undefined,
	options: TeammateExecutionOptions,
): Promise<TeammateExecutionResult> {
	const {
		onMessage,
		abortSignal,
		requestToolConfirmation,
		isToolAutoApproved,
		yoloMode,
		addToAlwaysApproved,
		requirePlanApproval,
	} = options;

	const instanceId = `teammate-${memberId}-${Date.now()}`;

	// Register with team tracker
	teamTracker.register({
		instanceId,
		memberId,
		memberName,
		role,
		worktreePath,
		teamName,
		prompt,
		startedAt: new Date(),
	});

	// Update team config member status
	const {updateMember} = await import('../team/teamConfig.js');
	updateMember(teamName, memberId, {instanceId, status: 'active'});

	try {
		const {collectAllMCPTools} = await import('./mcpToolsManager.js');
		const {executeMCPTool} = await import('./mcpToolsManager.js');
		const {getOpenAiConfig} = await import('../config/apiConfig.js');
		const {sessionManager} = await import('../session/sessionManager.js');
		const {createStreamingChatCompletion} = await import(
			'../../api/chat.js'
		);
		const {createStreamingAnthropicCompletion} = await import(
			// @ts-ignore - generated at build time
			'../../api/anthropic.js'
		);
		const {createStreamingGeminiCompletion} = await import(
			'../../api/gemini.js'
		);
		const {createStreamingResponse} = await import(
			'../../api/responses.js'
		);
		const {
			shouldCompressSubAgentContext,
			compressSubAgentContext,
			getContextPercentage,
			countMessagesTokens,
		} = await import('../core/subAgentContextCompressor.js');
		const {listTasks, claimTask, completeTask} = await import(
			'../team/teamTaskList.js'
		);

		// Collect all MCP tools (full access for teammates)
		const allMCPTools = await collectAllMCPTools();
		const allowedTools: MCPTool[] = [...allMCPTools];

		// Build teammate-specific synthetic tools
		const messageTeammateTool: MCPTool = {
			type: 'function' as const,
			function: {
				name: 'message_teammate',
				description:
					'Send a message to another teammate or the team lead. Use to share findings, coordinate work, or request help.',
				parameters: {
					type: 'object',
					properties: {
						target: {
							type: 'string',
							description:
								'The name or member ID of the target teammate, or "lead" to message the team lead.',
						},
						content: {
							type: 'string',
							description: 'The message content to send.',
						},
					},
					required: ['target', 'content'],
				},
			},
		};

		const claimTaskTool: MCPTool = {
			type: 'function' as const,
			function: {
				name: 'claim_task',
				description:
					'Claim a pending task from the shared task list. The task must be pending and have no unresolved dependencies.',
				parameters: {
					type: 'object',
					properties: {
						task_id: {
							type: 'string',
							description: 'The ID of the task to claim.',
						},
					},
					required: ['task_id'],
				},
			},
		};

		const completeTaskTool: MCPTool = {
			type: 'function' as const,
			function: {
				name: 'complete_task',
				description:
					'Mark a task as completed after finishing the work.',
				parameters: {
					type: 'object',
					properties: {
						task_id: {
							type: 'string',
							description: 'The ID of the task to mark as completed.',
						},
					},
					required: ['task_id'],
				},
			},
		};

		const listTasksTool: MCPTool = {
			type: 'function' as const,
			function: {
				name: 'list_team_tasks',
				description:
					'View all tasks in the shared task list with their status, assignees, and dependencies.',
				parameters: {
					type: 'object',
					properties: {},
					required: [],
				},
			},
		};

		const requestPlanApprovalTool: MCPTool = {
			type: 'function' as const,
			function: {
				name: 'request_plan_approval',
				description:
					'Submit your implementation plan to the team lead for review and approval. Required when the lead specified plan approval for this teammate.',
				parameters: {
					type: 'object',
					properties: {
						plan: {
							type: 'string',
							description:
								'Your detailed implementation plan in markdown format.',
						},
					},
					required: ['plan'],
				},
			},
		};

	const waitForMessagesTool: MCPTool = {
		type: 'function' as const,
		function: {
			name: 'wait_for_messages',
			description:
				'Block and wait for incoming messages from the lead, user, or other teammates. Call this when you have finished all current work and are waiting for further instructions. This is efficient — no resources are consumed while waiting. Returns immediately if messages are already queued.',
			parameters: {
				type: 'object',
				properties: {
					summary: {
						type: 'string',
						description: 'Brief summary of work completed so far, sent to the lead.',
					},
				},
				required: ['summary'],
			},
		},
	};

	allowedTools.push(
		messageTeammateTool,
		claimTaskTool,
		completeTaskTool,
		listTasksTool,
		waitForMessagesTool,
	);
		if (requirePlanApproval) {
			allowedTools.push(requestPlanApprovalTool);
		}

		// Build initial prompt with team context
		const otherTeammates = teamTracker
			.getRunningTeammates()
			.filter(t => t.instanceId !== instanceId);

		const tasks = listTasks(teamName);
		let teamContext = `\n\n## Team Context
You are teammate "${memberName}" in team "${teamName}".
Your working directory (Git worktree): ${worktreePath}
${role ? `Your role: ${role}` : ''}

### Other Teammates`;

		if (otherTeammates.length > 0) {
			teamContext += '\n' + otherTeammates
				.map(t => `- ${t.memberName}${t.role ? ` (${t.role})` : ''} [${t.instanceId}]`)
				.join('\n');
		} else {
			teamContext += '\nNo other teammates are currently active.';
		}

		teamContext += '\n\n### Shared Task List';
		if (tasks.length > 0) {
			teamContext += '\n' + tasks
				.map(t => {
					const deps = t.dependencies?.length
						? ` (depends on: ${t.dependencies.join(', ')})`
						: '';
					const assignee = t.assigneeName ? ` [assigned to: ${t.assigneeName}]` : '';
					return `- [${t.status}] ${t.id}: ${t.title}${deps}${assignee}`;
				})
				.join('\n');
		} else {
			teamContext += '\nNo tasks defined yet.';
		}

		teamContext += `\n\n### Available Tools
- \`message_teammate\`: Send a message to another teammate or the lead
- \`claim_task\`: Claim a pending task from the task list
- \`complete_task\`: Mark a task as completed
- \`list_team_tasks\`: View the current task list
- \`wait_for_messages\`: **MUST call when all current work is done.** Blocks efficiently until new messages arrive. Provide a summary of completed work.

### Rules
- You do NOT shut yourself down — the team lead controls your lifecycle.
- **NEVER run \`git push\`.** All pushes are handled by the lead after merging.
- **When you finish all assigned work, you MUST call \`wait_for_messages\` with a summary.** This notifies the lead and efficiently blocks until new instructions arrive. Do NOT end your turn without calling \`wait_for_messages\`.`;

		if (requirePlanApproval) {
			teamContext += `\n- \`request_plan_approval\`: Submit your plan to the lead for approval (REQUIRED before making changes)`;
			teamContext += `\n\n**IMPORTANT**: You are in plan-approval mode. You must submit your plan via \`request_plan_approval\` and wait for approval before making any file changes.`;
		}

		const finalPrompt = `${prompt}${teamContext}`;

		const messages: ChatMessage[] = [
			{role: 'user', content: finalPrompt},
		];

		let finalResponse = '';
		let totalUsage: TokenUsage | undefined;
		let latestTotalTokens = 0;
		let planApproved = !requirePlanApproval; // Skip approval if not required

		// eslint-disable-next-line no-constant-condition
		while (true) {
			if (abortSignal?.aborted) {
				return {
					success: false,
					result: finalResponse,
					error: 'Teammate execution aborted',
				};
			}

			// Dequeue messages from lead or other teammates
			const teammateMessages = teamTracker.dequeueTeammateMessages(instanceId);
			for (const msg of teammateMessages) {
				messages.push({
					role: 'user',
					content: `[Message from ${msg.fromMemberName}]\n${msg.content}`,
				});

				if (onMessage) {
					onMessage({
						type: 'sub_agent_message',
						agentId: `teammate-${memberId}`,
						agentName: memberName,
						message: {
							type: 'inter_agent_received',
							fromAgentId: msg.fromMemberId,
							fromAgentName: msg.fromMemberName,
							content: msg.content,
						},
					});
				}
			}

			// API call
			const config = getOpenAiConfig();
			const model = config.advancedModel || 'gpt-5';
			const currentSession = sessionManager.getCurrentSession();

			const stream =
				config.requestMethod === 'anthropic'
					? createStreamingAnthropicCompletion(
							{model, messages, temperature: 0, max_tokens: config.maxTokens || 4096, tools: allowedTools, sessionId: currentSession?.id},
							abortSignal,
					  )
					: config.requestMethod === 'gemini'
					? createStreamingGeminiCompletion(
							{model, messages, temperature: 0, tools: allowedTools},
							abortSignal,
					  )
					: config.requestMethod === 'responses'
					? createStreamingResponse(
							{model, messages, temperature: 0, tools: allowedTools, prompt_cache_key: currentSession?.id},
							abortSignal,
					  )
					: createStreamingChatCompletion(
							{model, messages, temperature: 0, tools: allowedTools},
							abortSignal,
					  );

			let currentContent = '';
			let toolCalls: any[] = [];
			let currentThinking: {type: 'thinking'; thinking: string; signature?: string} | undefined;
			let currentReasoningContent: string | undefined;
			let currentReasoning: {summary?: any; content?: any; encrypted_content?: string} | undefined;

			for await (const event of stream) {
				if (onMessage) {
					onMessage({
						type: 'sub_agent_message',
						agentId: `teammate-${memberId}`,
						agentName: memberName,
						message: event,
					});
				}

				if (event.type === 'usage' && event.usage) {
					const eu = event.usage;
					latestTotalTokens = eu.total_tokens || (eu.prompt_tokens || 0) + (eu.completion_tokens || 0);

					if (!totalUsage) {
						totalUsage = {
							inputTokens: eu.prompt_tokens || 0,
							outputTokens: eu.completion_tokens || 0,
							cacheCreationInputTokens: eu.cache_creation_input_tokens,
							cacheReadInputTokens: eu.cache_read_input_tokens,
						};
					} else {
						totalUsage.inputTokens += eu.prompt_tokens || 0;
						totalUsage.outputTokens += eu.completion_tokens || 0;
					}

					if (onMessage && config.maxContextTokens && latestTotalTokens > 0) {
						const ctxPct = getContextPercentage(latestTotalTokens, config.maxContextTokens);
						onMessage({
							type: 'sub_agent_message',
							agentId: `teammate-${memberId}`,
							agentName: memberName,
							message: {
								type: 'context_usage',
								percentage: Math.max(1, Math.round(ctxPct)),
								inputTokens: latestTotalTokens,
								maxTokens: config.maxContextTokens,
							},
						});
					}
				}

				if (event.type === 'content' && event.content) {
					currentContent += event.content;
				} else if (event.type === 'tool_calls' && event.tool_calls) {
					toolCalls = event.tool_calls;
				} else if (event.type === 'reasoning_data' && 'reasoning' in event) {
					currentReasoning = event.reasoning as typeof currentReasoning;
				} else if (event.type === 'done') {
					if ('thinking' in event && event.thinking) {
						currentThinking = event.thinking as typeof currentThinking;
					}
					if ('reasoning_content' in event && event.reasoning_content) {
						currentReasoningContent = event.reasoning_content as string;
					}
				}
			}

			// Tiktoken fallback when API doesn't return usage
			if (latestTotalTokens === 0 && config.maxContextTokens) {
				latestTotalTokens = countMessagesTokens(messages);
				if (onMessage && latestTotalTokens > 0) {
					const ctxPct = getContextPercentage(latestTotalTokens, config.maxContextTokens);
					onMessage({
						type: 'sub_agent_message',
						agentId: `teammate-${memberId}`,
						agentName: memberName,
						message: {
							type: 'context_usage',
							percentage: Math.max(1, Math.round(ctxPct)),
							inputTokens: latestTotalTokens,
							maxTokens: config.maxContextTokens,
						},
					});
				}
			}

			// Build assistant message
			if (currentContent || toolCalls.length > 0) {
				const assistantMessage: ChatMessage = {
					role: 'assistant',
					content: currentContent || '',
				};
				if (currentThinking) assistantMessage.thinking = currentThinking;
				if (currentReasoningContent) (assistantMessage as any).reasoning_content = currentReasoningContent;
				if (currentReasoning) (assistantMessage as any).reasoning = currentReasoning;
				if (toolCalls.length > 0) assistantMessage.tool_calls = toolCalls;
				messages.push(assistantMessage);
				finalResponse = currentContent;
			}

			// Context compression
			let justCompressed = false;
			if (latestTotalTokens > 0 && config.maxContextTokens) {
				if (shouldCompressSubAgentContext(latestTotalTokens, config.maxContextTokens)) {
					const ctxPercentage = getContextPercentage(latestTotalTokens, config.maxContextTokens);

					if (onMessage) {
						onMessage({
							type: 'sub_agent_message',
							agentId: `teammate-${memberId}`,
							agentName: memberName,
							message: {
								type: 'context_compressing',
								percentage: Math.round(ctxPercentage),
							},
						});
					}

					try {
						const compressionResult = await compressSubAgentContext(
							messages, latestTotalTokens, config.maxContextTokens,
							{model, requestMethod: config.requestMethod, maxTokens: config.maxTokens},
						);
						if (compressionResult.compressed) {
							messages.length = 0;
							messages.push(...compressionResult.messages);
							justCompressed = true;
							if (compressionResult.afterTokensEstimate) {
								latestTotalTokens = compressionResult.afterTokensEstimate;
							}

							if (onMessage) {
								onMessage({
									type: 'sub_agent_message',
									agentId: `teammate-${memberId}`,
									agentName: memberName,
									message: {
										type: 'context_compressed',
										beforeTokens: compressionResult.beforeTokens,
										afterTokensEstimate: compressionResult.afterTokensEstimate,
									},
								});
							}

							console.log(
								`[Teammate:${memberName}] Context compressed: ` +
								`${compressionResult.beforeTokens} → ~${compressionResult.afterTokensEstimate} tokens`,
							);
						}
					} catch (compressError) {
						console.error(
							`[Teammate:${memberName}] Context compression failed:`,
							compressError,
						);
					}
				}
			}

			if (justCompressed && toolCalls.length === 0) {
				while (messages.length > 0 && messages[messages.length - 1]?.role === 'assistant') {
					messages.pop();
				}
				messages.push({
					role: 'user',
					content: '[System] Context has been auto-compressed. Your task is NOT finished. Continue working.',
				});
				continue;
			}

		// No tool calls = AI forgot to call wait_for_messages. Prompt it to do so.
		if (toolCalls.length === 0) {
			messages.push({
				role: 'user',
				content: '[System] Your work appears complete, but you did not call `wait_for_messages`. You MUST call `wait_for_messages` with a summary instead of ending your turn. This keeps you available for follow-up instructions from the lead or other teammates.',
			});
			continue;
		}

		// Handle synthetic team tools internally
		const syntheticToolNames = new Set([
			'message_teammate', 'claim_task', 'complete_task',
			'list_team_tasks', 'request_plan_approval', 'wait_for_messages',
		]);

		const syntheticCalls = toolCalls.filter(tc => syntheticToolNames.has(tc.function.name));
		const regularCalls = toolCalls.filter(tc => !syntheticToolNames.has(tc.function.name));

		// Handle wait_for_messages separately — it's async and blocks
		const waitCall = syntheticCalls.find(tc => tc.function.name === 'wait_for_messages');
		const otherSyntheticCalls = syntheticCalls.filter(tc => tc.function.name !== 'wait_for_messages');

		// Process non-blocking synthetic tools first
		for (const tc of otherSyntheticCalls) {
				let args: any = {};
				try {
					args = JSON.parse(tc.function.arguments);
				} catch { /* empty */ }

				let resultContent = '';

				switch (tc.function.name) {
					case 'message_teammate': {
						const target = args.target as string;
						const content = args.content as string;

						if (target === 'lead' || target === 'Team Lead') {
							const sent = teamTracker.sendMessageToLead(instanceId, content);
							resultContent = sent
								? 'Message sent to team lead.'
								: 'Failed to send message to team lead.';
						} else {
							let targetTeammate = teamTracker.findByMemberName(target)
								|| teamTracker.findByMemberId(target);

							if (targetTeammate) {
								const sent = teamTracker.sendMessageToTeammate(
									instanceId, targetTeammate.instanceId, content,
								);
								resultContent = sent
									? `Message sent to ${targetTeammate.memberName}.`
									: `Failed to send message to ${target}.`;
							} else {
								resultContent = `Teammate "${target}" not found. Use list_team_tasks to see current teammates.`;
							}
						}
						break;
					}

					case 'claim_task': {
						try {
							const task = claimTask(teamName, args.task_id, memberId, memberName);
							if (task) {
								teamTracker.setCurrentTask(instanceId, task.id);
								resultContent = `Successfully claimed task "${task.title}" (${task.id}).`;
							} else {
								resultContent = `Task "${args.task_id}" not found.`;
							}
						} catch (e: any) {
							resultContent = `Failed to claim task: ${e.message}`;
						}
						break;
					}

					case 'complete_task': {
						try {
							const task = completeTask(teamName, args.task_id);
							if (task) {
								teamTracker.setCurrentTask(instanceId, undefined);
								teamTracker.sendMessageToLead(
									instanceId,
									`Task completed: "${task.title}" (${task.id})`,
								);
								resultContent = `Task "${task.title}" marked as completed.`;
							} else {
								resultContent = `Task "${args.task_id}" not found.`;
							}
						} catch (e: any) {
							resultContent = `Failed to complete task: ${e.message}`;
						}
						break;
					}

					case 'list_team_tasks': {
						const currentTasks = listTasks(teamName);
						if (currentTasks.length === 0) {
							resultContent = 'No tasks in the task list.';
						} else {
							resultContent = currentTasks
								.map(t => {
									const deps = t.dependencies?.length ? ` (deps: ${t.dependencies.join(', ')})` : '';
									const assignee = t.assigneeName ? ` [${t.assigneeName}]` : '';
									return `[${t.status}] ${t.id}: ${t.title}${assignee}${deps}`;
								})
								.join('\n');
						}
						break;
					}

					case 'request_plan_approval': {
						teamTracker.requestPlanApproval(instanceId, args.plan);
						resultContent = 'Plan submitted for approval. Waiting for lead response...';
						break;
					}

				}

				messages.push({
					role: 'tool' as const,
					tool_call_id: tc.id,
					content: resultContent,
				});
			}

		// Handle wait_for_messages: notify lead, mark standby, then block until messages arrive
		if (waitCall) {
			let waitArgs: any = {};
			try { waitArgs = JSON.parse(waitCall.function.arguments); } catch { /* empty */ }

			const summary = waitArgs.summary || 'Work completed.';

			// Mark as standby so wait_for_teammates knows this teammate is idle
			teamTracker.setStandby(instanceId);

			teamTracker.sendMessageToLead(
				instanceId,
				`[Standby] ${memberName} has completed current work. Summary: ${summary}`,
			);

			if (onMessage) {
				onMessage({
					type: 'sub_agent_message',
					agentId: `teammate-${memberId}`,
					agentName: memberName,
					message: {type: 'status', status: 'standby'} as any,
				});
			}

			// Block until messages arrive or aborted
			let receivedMessages: typeof teammateMessages = [];
			while (!abortSignal?.aborted) {
				const incoming = teamTracker.dequeueTeammateMessages(instanceId);
				if (incoming.length > 0) {
					receivedMessages = incoming;
					break;
				}
				await new Promise(resolve => setTimeout(resolve, 500));
			}

			// Clear standby — teammate is resuming or exiting
			teamTracker.clearStandby(instanceId);

			if (abortSignal?.aborted) {
				messages.push({
					role: 'tool' as const,
					tool_call_id: waitCall.id,
					content: 'Session terminated by team lead.',
				});
				break;
			}

			const msgSummary = receivedMessages
				.map(m => `[${m.fromMemberName}]: ${m.content}`)
				.join('\n');
			messages.push({
				role: 'tool' as const,
				tool_call_id: waitCall.id,
				content: `Received ${receivedMessages.length} message(s):\n${msgSummary}`,
			});

			// Skip regular tool calls this iteration — the AI should process the messages first
			continue;
		}

		// Process regular MCP tool calls
			if (regularCalls.length > 0) {
				// Plan approval gate: block file-modifying tools until approved
				if (!planApproved) {
					const blockedTools = regularCalls.filter(tc => {
						const name = tc.function.name;
						return name.includes('write') || name.includes('create') ||
							name.includes('delete') || name.includes('execute') ||
							name.includes('bash') || name.includes('terminal');
					});

					if (blockedTools.length > 0) {
						for (const tc of blockedTools) {
							messages.push({
								role: 'tool' as const,
								tool_call_id: tc.id,
								content: 'Error: Plan approval required before making changes. Use request_plan_approval first.',
							});
						}
						// Only execute non-blocked regular calls
						const nonBlockedCalls = regularCalls.filter(tc => !blockedTools.includes(tc));
						if (nonBlockedCalls.length === 0 && syntheticCalls.length > 0) {
							continue;
						}
						// Fall through to execute non-blocked calls
						for (const tc of nonBlockedCalls) {
							try {
								const toolArgs = JSON.parse(tc.function.arguments || '{}');
								const result = await executeMCPTool(tc.function.name, toolArgs, abortSignal);
								messages.push({
									role: 'tool' as const,
									tool_call_id: tc.id,
									content: typeof result === 'string' ? result : JSON.stringify(result),
								});
							} catch (e: any) {
								messages.push({
									role: 'tool' as const,
									tool_call_id: tc.id,
									content: `Error: ${e.message}`,
								});
							}
						}
						continue;
					}
				}

				for (const tc of regularCalls) {
					const toolName = tc.function.name;
					let toolArgs: any = {};
					try {
						toolArgs = JSON.parse(tc.function.arguments || '{}');
					} catch { /* empty */ }

					let approved = yoloMode || false;
					if (!approved && isToolAutoApproved) {
						approved = isToolAutoApproved(toolName);
					}
					if (!approved && requestToolConfirmation) {
						const confirmResult = await requestToolConfirmation(toolName, toolArgs);
						if (confirmResult === 'approve' || confirmResult === 'approve_always') {
							approved = true;
							if (confirmResult === 'approve_always' && addToAlwaysApproved) {
								addToAlwaysApproved(toolName);
							}
						} else {
							const feedback = typeof confirmResult === 'object' && confirmResult.type === 'reject_with_reply'
								? confirmResult.reason
								: 'Tool execution denied by user.';
							messages.push({
								role: 'tool' as const,
								tool_call_id: tc.id,
								content: feedback,
							});
							continue;
						}
					} else {
						approved = true;
					}

					if (approved) {
						try {
							const result = await executeMCPTool(toolName, toolArgs, abortSignal);
							messages.push({
								role: 'tool' as const,
								tool_call_id: tc.id,
								content: typeof result === 'string' ? result : JSON.stringify(result),
							});
						} catch (e: any) {
							messages.push({
								role: 'tool' as const,
								tool_call_id: tc.id,
								content: `Error: ${e.message}`,
							});
						}
					}
				}
			}

			// If plan approval was requested and approved, mark it
			const approvalCheck = teamTracker.getPendingApprovals()
				.find(a => a.fromInstanceId === instanceId && a.status === 'approved');
			if (approvalCheck) {
				planApproved = true;
			}
		}

		// Notify lead that this teammate is done
		teamTracker.storeResult({
			instanceId,
			memberId,
			memberName,
			success: true,
			result: finalResponse,
			completedAt: new Date(),
		});

		if (onMessage) {
			onMessage({
				type: 'sub_agent_message',
				agentId: `teammate-${memberId}`,
				agentName: memberName,
				message: {type: 'done'},
			});
		}

		return {
			success: true,
			result: finalResponse,
			usage: totalUsage,
		};
	} catch (error: any) {
		teamTracker.storeResult({
			instanceId,
			memberId,
			memberName,
			success: false,
			result: '',
			error: error.message,
			completedAt: new Date(),
		});

		return {
			success: false,
			result: '',
			error: error.message,
		};
	} finally {
		// Auto-commit any uncommitted work before unregistering
		try {
			const {autoCommitWorktreeChanges} = await import('../team/teamWorktree.js');
			autoCommitWorktreeChanges(worktreePath, memberName);
		} catch { /* best effort */ }

		updateMember(teamName, memberId, {status: 'shutdown', shutdownAt: new Date().toISOString()});
		teamTracker.unregister(instanceId);
	}
}
