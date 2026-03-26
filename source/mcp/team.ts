/**
 * Team Service
 * Provides team management tools for the lead agent in Agent Team mode.
 * Tools are registered as MCP-style tools with "team-" prefix.
 */

import {
	createTeam,
	getActiveTeam,
	addMember,
	disbandTeam,
} from '../utils/team/teamConfig.js';
import {
	createTask,
	assignTask,
	updateTaskStatus,
	listTasks,
} from '../utils/team/teamTaskList.js';
import {
	createTeamWorktree,
	cleanupTeamWorktrees,
	isGitRepo,
	autoCommitWorktreeChanges,
	mergeTeammateBranch,
	getTeammateDiffSummary,
	isInMergeState,
	getConflictedFiles,
	completeMerge,
	abortCurrentMerge,
	type MergeStrategy,
} from '../utils/team/teamWorktree.js';
import {existsSync} from 'fs';
import {teamTracker} from '../utils/execution/teamTracker.js';
import {executeTeammate} from '../utils/execution/teamExecutor.js';
import type {SubAgentMessage} from '../utils/execution/subAgentExecutor.js';
import type {ConfirmationResult} from '../ui/components/tools/ToolConfirmation.js';
import {getConversationContext} from '../utils/codebase/conversationContext.js';
import {recordTeamCreated, recordMemberSpawned} from '../utils/team/teamSnapshot.js';

export interface TeamToolExecutionOptions {
	toolName: string;
	args: Record<string, any>;
	onMessage?: (message: SubAgentMessage) => void;
	abortSignal?: AbortSignal;
	requestToolConfirmation?: (
		toolName: string,
		toolArgs: any,
	) => Promise<ConfirmationResult>;
	isToolAutoApproved?: (toolName: string) => boolean;
	yoloMode?: boolean;
	addToAlwaysApproved?: (toolName: string) => void;
	requestUserQuestion?: (
		question: string,
		options: string[],
		multiSelect?: boolean,
	) => Promise<{selected: string | string[]; customInput?: string}>;
}

export class TeamService {
	async execute(options: TeamToolExecutionOptions): Promise<any> {
		const {toolName, args} = options;

		switch (toolName) {
			case 'spawn_teammate':
				return this.spawnTeammate(options);
			case 'message_teammate':
				return this.messageTeammate(args);
			case 'broadcast_to_team':
				return this.broadcastToTeam(args);
			case 'shutdown_teammate':
				return this.shutdownTeammate(args);
			case 'wait_for_teammates':
				return this.waitForTeammates(args, options.abortSignal);
			case 'create_task':
				return this.createTask(args);
			case 'update_task':
				return this.updateTask(args);
			case 'list_tasks':
				return this.listTasks();
			case 'list_teammates':
				return this.listTeammates();
			case 'merge_teammate_work':
				return this.mergeTeammateWork(args);
			case 'merge_all_teammate_work':
				return this.mergeAllTeammateWork(args);
			case 'resolve_merge_conflicts':
				return this.resolveMergeConflicts();
			case 'abort_merge':
				return this.abortMerge();
			case 'cleanup_team':
				return this.cleanupTeam();
			case 'approve_plan':
				return this.approvePlan(args);
			default:
				throw new Error(`Unknown team tool: ${toolName}`);
		}
	}

	private async spawnTeammate(options: TeamToolExecutionOptions): Promise<any> {
		const {args, onMessage, abortSignal, requestToolConfirmation, isToolAutoApproved, yoloMode, addToAlwaysApproved, requestUserQuestion} = options;
		const name = args['name'] as string;
		const role = args['role'] as string | undefined;
		const prompt = args['prompt'] as string;
		const requirePlanApproval = args['require_plan_approval'] as boolean | undefined;

		if (!name || !prompt) {
			throw new Error('spawn_teammate requires "name" and "prompt" parameters');
		}

		if (!isGitRepo()) {
			throw new Error('Agent Teams require a Git repository. Initialize git first.');
		}

		// Ensure a team exists
		let team = getActiveTeam();
		const isNewTeam = !team;
		if (!team) {
			const teamName = `team-${Date.now()}`;
			team = createTeam(teamName, 'lead');
			teamTracker.setActiveTeam(teamName);
		}

		// Create Git worktree for this teammate
		const worktreePath = await createTeamWorktree(team.name, name);

		// Add member to team config
		const member = addMember(team.name, name, worktreePath, role);

		// Record snapshots for rollback
		const ctx = getConversationContext();
		if (ctx) {
			if (isNewTeam) {
				recordTeamCreated(ctx.sessionId, ctx.messageIndex, team.name);
			}
			recordMemberSpawned(ctx.sessionId, ctx.messageIndex, team.name, member.id, name, worktreePath);
		}

		// Create a managed AbortController so rollback can force-stop this teammate
		const teammateAC = teamTracker.createAbortController(member.id, abortSignal);

		// Spawn teammate execution (fire-and-forget)
		executeTeammate(
			member.id,
			name,
			prompt,
			worktreePath,
			team.name,
			role,
			{
				onMessage,
				abortSignal: teammateAC.signal,
				requestToolConfirmation,
				isToolAutoApproved,
				yoloMode,
				addToAlwaysApproved,
				requestUserQuestion,
				requirePlanApproval,
			},
		).catch(error => {
			console.error(`Teammate ${name} failed:`, error);
		});

		return {
			success: true,
			result: `Teammate "${name}" spawned successfully.`,
			memberId: member.id,
			worktreePath,
			role: role || 'general',
		};
	}

	private messageTeammate(args: Record<string, any>): any {
		const targetId = args['target_id'] as string;
		const content = args['content'] as string;

		if (!targetId || !content) {
			throw new Error('message_teammate requires "target_id" and "content"');
		}

		// Find teammate by member ID or name
		let teammate = teamTracker.findByMemberId(targetId)
			|| teamTracker.findByMemberName(targetId);

		if (!teammate) {
			return {
				success: false,
				error: `Teammate "${targetId}" not found or not running.`,
			};
		}

		const sent = teamTracker.sendMessageToTeammate(
			'lead',
			teammate.instanceId,
			content,
		);

		return {
			success: sent,
			result: sent
				? `Message sent to ${teammate.memberName}.`
				: `Failed to send message to ${targetId}.`,
		};
	}

	private broadcastToTeam(args: Record<string, any>): any {
		const content = args['content'] as string;
		if (!content) {
			throw new Error('broadcast_to_team requires "content"');
		}

		const count = teamTracker.broadcastToTeammates('lead', content);
		return {
			success: true,
			result: `Broadcast sent to ${count} teammate(s).`,
		};
	}

	private shutdownTeammate(args: Record<string, any>): any {
		const targetId = args['target_id'] as string;
		const reason = args['reason'] as string | undefined;

		if (!targetId) {
			throw new Error('shutdown_teammate requires "target_id"');
		}

		let teammate = teamTracker.findByMemberId(targetId)
			|| teamTracker.findByMemberName(targetId);

		if (!teammate) {
			return {
				success: false,
				error: `Teammate "${targetId}" not found or not running.`,
			};
		}

		// Abort the teammate's execution directly — teammates cannot self-terminate
		const controller = teamTracker.getAbortController(teammate.memberId);
		if (controller) {
			controller.abort();
		}

		return {
			success: true,
			result: `Teammate ${teammate.memberName} has been shut down.${reason ? ` Reason: ${reason}` : ''}`,
		};
	}

	private async waitForTeammates(
		args: Record<string, any>,
		abortSignal?: AbortSignal,
	): Promise<any> {
		const running = teamTracker.getRunningTeammates();
		if (running.length === 0) {
			const results = teamTracker.drainResults();
			const leadMessages = teamTracker.dequeueLeadMessages();
			return {
				success: true,
				result: 'No teammates are running.',
				completedResults: results.map(r => ({
					name: r.memberName,
					success: r.success,
					summary: r.result?.slice(0, 500),
					error: r.error,
				})),
				messages: leadMessages.map(m => ({
					from: m.fromMemberName,
					content: m.content?.slice(0, 500),
				})),
			};
		}

		// Check if all are already on standby
		if (teamTracker.allInStandby()) {
			const results = teamTracker.drainResults();
			const leadMessages = teamTracker.dequeueLeadMessages();
			const standbyTeammates = running.map(t => t.memberName);
			return {
				success: true,
				result: `All ${running.length} teammate(s) are on standby (work complete). Use shutdown_teammate to shut them down, then merge their work.`,
				standbyTeammates,
				completedResults: results.map(r => ({
					name: r.memberName,
					success: r.success,
					summary: r.result?.slice(0, 500),
					error: r.error,
				})),
				messages: leadMessages.map(m => ({
					from: m.fromMemberName,
					content: m.content?.slice(0, 500),
				})),
			};
		}

		const timeoutMs = Math.min(
			Math.max((args['timeout_seconds'] as number || 600) * 1000, 10_000),
			1_800_000,
		);

		const allDone = await teamTracker.waitForAllTeammates(timeoutMs, abortSignal);

		const results = teamTracker.drainResults();
		const leadMessages = teamTracker.dequeueLeadMessages();
		const currentRunning = teamTracker.getRunningTeammates();
		const standbyTeammates = currentRunning
			.filter(t => teamTracker.isOnStandby(t.instanceId))
			.map(t => t.memberName);
		const stillWorking = currentRunning
			.filter(t => !teamTracker.isOnStandby(t.instanceId))
			.map(t => t.memberName);

		return {
			success: allDone,
			result: allDone
				? `All ${currentRunning.length} teammate(s) are on standby (work complete). Use shutdown_teammate to shut them down, then merge their work.`
				: `Timed out after ${timeoutMs / 1000}s. ${stillWorking.length} teammate(s) still working: ${stillWorking.join(', ')}`,
			standbyTeammates,
			stillWorking,
			completedResults: results.map(r => ({
				name: r.memberName,
				success: r.success,
				summary: r.result?.slice(0, 500),
				error: r.error,
			})),
			messages: leadMessages.map(m => ({
				from: m.fromMemberName,
				content: m.content?.slice(0, 500),
			})),
		};
	}

	private createTask(args: Record<string, any>): any {
		const team = getActiveTeam();
		if (!team) {
			throw new Error('No active team. You must call spawn_teammate first — the team is created automatically when the first teammate is spawned. Call spawn_teammate, then create_task.');
		}

		const title = args['title'] as string;
		const description = args['description'] as string | undefined;
		const dependencies = args['dependencies'] as string[] | undefined;
		const assigneeId = args['assignee_id'] as string | undefined;
		const assigneeName = args['assignee_name'] as string | undefined;

		if (!title) {
			throw new Error('create_task requires "title"');
		}

		const task = createTask(
			team.name, title, description,
			dependencies, assigneeId, assigneeName,
		);

		return {
			success: true,
			result: `Task created: "${task.title}" (${task.id})`,
			taskId: task.id,
		};
	}

	private updateTask(args: Record<string, any>): any {
		const team = getActiveTeam();
		if (!team) {
			throw new Error('No active team.');
		}

		const taskId = args['task_id'] as string;
		const status = args['status'] as string | undefined;
		const assigneeId = args['assignee_id'] as string | undefined;
		const assigneeName = args['assignee_name'] as string | undefined;

		if (!taskId) {
			throw new Error('update_task requires "task_id"');
		}

		if (status) {
			updateTaskStatus(team.name, taskId, status as any);
		}
		if (assigneeId) {
			assignTask(team.name, taskId, assigneeId, assigneeName || assigneeId);
		}

		return {success: true, result: `Task ${taskId} updated.`};
	}

	private listTasks(): any {
		const team = getActiveTeam();
		if (!team) {
			return {success: true, result: 'No active team.', tasks: []};
		}

		const tasks = listTasks(team.name);
		return {
			success: true,
			tasks: tasks.map(t => ({
				id: t.id,
				title: t.title,
				description: t.description,
				status: t.status,
				assignee: t.assigneeName || t.assigneeId,
				dependencies: t.dependencies,
			})),
		};
	}

	private listTeammates(): any {
		const teammates = teamTracker.getRunningTeammates();
		return {
			success: true,
			teammates: teammates.map(t => ({
				memberId: t.memberId,
				name: t.memberName,
				role: t.role,
				instanceId: t.instanceId,
				worktreePath: t.worktreePath,
				currentTaskId: t.currentTaskId,
				runningFor: `${Math.round((Date.now() - t.startedAt.getTime()) / 1000)}s`,
			})),
		};
	}

	private mergeTeammateWork(args: Record<string, any>): any {
		const team = getActiveTeam();
		if (!team) {
			throw new Error('No active team.');
		}

		if (isInMergeState()) {
			return {
				success: false,
				error: 'A merge is already in progress. Call team-resolve_merge_conflicts to complete it or team-abort_merge to cancel.',
			};
		}

		const targetName = args['name'] as string;
		if (!targetName) {
			throw new Error('merge_teammate_work requires "name"');
		}

		const strategy = (args['strategy'] as MergeStrategy) || 'manual';

		const member = team.members.find(
			m => m.name.toLowerCase() === targetName.toLowerCase(),
		);
		if (!member) {
			return {success: false, error: `Member "${targetName}" not found in team.`};
		}

		if (member.worktreePath && existsSync(member.worktreePath)) {
			autoCommitWorktreeChanges(member.worktreePath, member.name);
		}

		const result = mergeTeammateBranch(team.name, member.name, strategy);

		if (result.success && result.merged) {
			return {
				success: true,
				result: `Merged ${result.commitCount} commit(s) from ${member.name} (${result.filesChanged} files changed).`,
			};
		} else if (result.success && !result.merged) {
			return {
				success: true,
				result: `${member.name} has no changes to merge.`,
			};
		} else if (result.hasConflicts) {
			return {
				success: false,
				hasConflicts: true,
				conflictFiles: result.conflictFiles,
				error: result.error,
				hint: 'Read the conflicted files, edit them to resolve conflict markers (<<<<<<< / ======= / >>>>>>>), then call team-resolve_merge_conflicts.',
			};
		} else {
			return {
				success: false,
				error: result.error,
				conflictFiles: result.conflictFiles,
			};
		}
	}

	private mergeAllTeammateWork(args: Record<string, any>): any {
		const team = getActiveTeam();
		if (!team) {
			throw new Error('No active team.');
		}

		if (isInMergeState()) {
			return {
				success: false,
				error: 'A merge is already in progress. Call team-resolve_merge_conflicts to complete it or team-abort_merge to cancel.',
			};
		}

		const running = teamTracker.getRunningTeammates();
		if (running.length > 0) {
			return {
				success: false,
				error: `Cannot merge: ${running.length} teammate(s) still running. Wait for them to finish first.`,
				runningTeammates: running.map(t => t.memberName),
			};
		}

		const strategy = (args['strategy'] as MergeStrategy) || 'manual';
		const results: Array<{name: string; merged: boolean; commits: number; files: number; error?: string; conflictFiles?: string[]}> = [];

		for (const member of team.members) {
			if (member.worktreePath && existsSync(member.worktreePath)) {
				autoCommitWorktreeChanges(member.worktreePath, member.name);
			}

			const diff = getTeammateDiffSummary(team.name, member.name);
			if (!diff || diff.commitCount === 0) {
				results.push({name: member.name, merged: false, commits: 0, files: 0});
				continue;
			}

			const mergeResult = mergeTeammateBranch(team.name, member.name, strategy);
			if (mergeResult.success && mergeResult.merged) {
				results.push({
					name: member.name,
					merged: true,
					commits: mergeResult.commitCount,
					files: mergeResult.filesChanged,
				});
			} else if (mergeResult.hasConflicts) {
				results.push({
					name: member.name,
					merged: false,
					commits: mergeResult.commitCount,
					files: 0,
					error: mergeResult.error,
					conflictFiles: mergeResult.conflictFiles,
				});
				const mergedCount = results.filter(r => r.merged).length;
				return {
					success: false,
					hasConflicts: true,
					error: `Merge conflicts at ${member.name}. ${mergedCount} teammate(s) merged before the conflict. Working directory is in merge state — resolve conflicts then call team-resolve_merge_conflicts.`,
					conflictFiles: mergeResult.conflictFiles,
					results,
					stoppedAt: member.name,
				};
			} else if (!mergeResult.success) {
				results.push({
					name: member.name,
					merged: false,
					commits: mergeResult.commitCount,
					files: 0,
					error: mergeResult.error,
				});
				break;
			} else {
				results.push({name: member.name, merged: false, commits: 0, files: 0});
			}
		}

		const mergedCount = results.filter(r => r.merged).length;
		const totalCommits = results.reduce((sum, r) => sum + r.commits, 0);
		const failedResult = results.find(r => r.error && !r.conflictFiles?.length);

		if (failedResult) {
			return {
				success: false,
				error: `Merge failed at ${failedResult.name}: ${failedResult.error}`,
				results,
			};
		}

		return {
			success: true,
			result: `All teammate work merged. ${mergedCount} teammate(s) with changes, ${totalCommits} total commit(s).`,
			results,
		};
	}

	private resolveMergeConflicts(): any {
		if (!isInMergeState()) {
			return {success: false, error: 'Not currently in a merge state. Nothing to resolve.'};
		}

		const remaining = getConflictedFiles();
		if (remaining.length > 0) {
			return {
				success: false,
				error: `${remaining.length} file(s) still have unresolved conflict markers: ${remaining.join(', ')}. Edit them to remove <<<<<<< / ======= / >>>>>>> markers first.`,
				unresolvedFiles: remaining,
			};
		}

		const result = completeMerge();
		if (result.success) {
			return {
				success: true,
				result: 'Merge completed successfully. All conflicts resolved and committed.',
			};
		}
		return {success: false, error: result.error};
	}

	private abortMerge(): any {
		if (!isInMergeState()) {
			return {success: false, error: 'Not currently in a merge state.'};
		}

		const result = abortCurrentMerge();
		if (result.success) {
			return {
				success: true,
				result: 'Merge aborted. Working directory restored to pre-merge state.',
			};
		}
		return {success: false, error: result.error};
	}

	private async cleanupTeam(): Promise<any> {
		const team = getActiveTeam();
		if (!team) {
			return {success: false, error: 'No active team to clean up.'};
		}

		const running = teamTracker.getRunningTeammates();
		if (running.length > 0) {
			return {
				success: false,
				error: `Cannot clean up: ${running.length} teammate(s) still running. Shut them down first.`,
				runningTeammates: running.map(t => t.memberName),
			};
		}

		// Check for unmerged work
		const unmergedMembers: string[] = [];
		for (const member of team.members) {
			const diff = getTeammateDiffSummary(team.name, member.name);
			if (diff && diff.commitCount > 0) {
				unmergedMembers.push(`${member.name} (${diff.commitCount} commits, ${diff.filesChanged} files)`);
			}
		}

		if (unmergedMembers.length > 0) {
			return {
				success: false,
				error: `Cannot clean up: ${unmergedMembers.length} teammate(s) have unmerged work that will be LOST. Run team-merge_all_teammate_work first.`,
				unmergedMembers,
			};
		}

		// Clean up Git worktrees
		try {
			await cleanupTeamWorktrees(team.name);
		} catch (e: any) {
			console.error('Failed to cleanup worktrees:', e);
		}

		// Disband team and clear tracker
		disbandTeam(team.name);
		teamTracker.clearActiveTeam();

		return {
			success: true,
			result: `Team "${team.name}" has been cleaned up. Worktrees removed, team disbanded.`,
		};
	}

	private approvePlan(args: Record<string, any>): any {
		const targetId = args['target_id'] as string;
		const approved = args['approved'] as boolean;
		const feedback = args['feedback'] as string | undefined;

		if (!targetId || approved === undefined) {
			throw new Error('approve_plan requires "target_id" and "approved"');
		}

		let teammate = teamTracker.findByMemberId(targetId)
			|| teamTracker.findByMemberName(targetId);

		if (!teammate) {
			return {success: false, error: `Teammate "${targetId}" not found.`};
		}

		const resolved = teamTracker.resolvePlanApproval(
			teammate.instanceId,
			approved,
			feedback,
		);

		return {
			success: resolved,
			result: resolved
				? `Plan ${approved ? 'approved' : 'rejected'} for ${teammate.memberName}.`
				: `No pending plan approval found for ${targetId}.`,
		};
	}

	getTools(): Array<{
		name: string;
		description: string;
		inputSchema: any;
	}> {
		return [
			{
				name: 'spawn_teammate',
				description: 'Spawn a new teammate agent that works independently in its own Git worktree. Each teammate has full tool access and can communicate with other teammates.',
				inputSchema: {
					type: 'object',
					properties: {
						name: {type: 'string', description: 'A short, descriptive name for this teammate (e.g., "frontend", "backend", "tester").'},
						role: {type: 'string', description: 'Optional role description guiding the teammate\'s focus area.'},
						prompt: {type: 'string', description: 'The task prompt for this teammate. Include all relevant context since teammates don\'t inherit your conversation history.'},
						require_plan_approval: {type: 'boolean', description: 'If true, the teammate must submit a plan for your approval before making changes.'},
					},
					required: ['name', 'prompt'],
				},
			},
			{
				name: 'message_teammate',
				description: 'Send a direct message to a specific teammate. Use to provide guidance, share findings, or redirect their approach.',
				inputSchema: {
					type: 'object',
					properties: {
						target_id: {type: 'string', description: 'The member ID or name of the target teammate.'},
						content: {type: 'string', description: 'The message content.'},
					},
					required: ['target_id', 'content'],
				},
			},
			{
				name: 'broadcast_to_team',
				description: 'Send a message to all teammates simultaneously. Use sparingly as costs scale with team size.',
				inputSchema: {
					type: 'object',
					properties: {
						content: {type: 'string', description: 'The message to broadcast to all teammates.'},
					},
					required: ['content'],
				},
			},
		{
			name: 'shutdown_teammate',
			description: 'Immediately shut down a specific teammate. Teammates cannot self-terminate — this is the ONLY way to end a teammate. Teammates enter standby after finishing work, remaining available for messages until you shut them down.',
				inputSchema: {
					type: 'object',
					properties: {
						target_id: {type: 'string', description: 'The member ID or name of the teammate to shut down.'},
						reason: {type: 'string', description: 'Optional reason for the shutdown.'},
					},
					required: ['target_id'],
				},
			},
			{
			name: 'wait_for_teammates',
			description: 'Block and wait until ALL running teammates have entered standby (finished their work). Returns collected results and messages. After this returns, you should review results, then shut down teammates with shutdown_teammate, merge their work, and clean up.',
				inputSchema: {
					type: 'object',
					properties: {
						timeout_seconds: {type: 'number', description: 'Maximum time to wait in seconds. Default: 600 (10 min). Range: 10-1800.'},
					},
					required: [],
				},
			},
			{
				name: 'create_task',
				description: 'Create a new task in the shared task list. PREREQUISITE: At least one teammate must be spawned first (spawn_teammate creates the team). Calling this without an active team will fail.',
				inputSchema: {
					type: 'object',
					properties: {
						title: {type: 'string', description: 'Brief title for the task.'},
						description: {type: 'string', description: 'Detailed description of what needs to be done.'},
						dependencies: {type: 'array', items: {type: 'string'}, description: 'Task IDs that must be completed before this task can be claimed.'},
						assignee_id: {type: 'string', description: 'Optional member ID to pre-assign this task to.'},
						assignee_name: {type: 'string', description: 'Optional member name for the pre-assignment.'},
					},
					required: ['title'],
				},
			},
			{
				name: 'update_task',
				description: 'Update a task\'s status or reassign it.',
				inputSchema: {
					type: 'object',
					properties: {
						task_id: {type: 'string', description: 'The task ID to update.'},
						status: {type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'New status for the task.'},
						assignee_id: {type: 'string', description: 'New assignee member ID.'},
						assignee_name: {type: 'string', description: 'New assignee name.'},
					},
					required: ['task_id'],
				},
			},
			{
				name: 'list_tasks',
				description: 'View all tasks in the shared task list with status, assignees, and dependencies.',
				inputSchema: {
					type: 'object',
					properties: {},
					required: [],
				},
			},
			{
				name: 'list_teammates',
				description: 'View all currently running teammates with their status, roles, and current tasks.',
				inputSchema: {
					type: 'object',
					properties: {},
					required: [],
				},
			},
			{
				name: 'merge_teammate_work',
				description: 'Merge a specific teammate\'s Git branch into the main branch. Auto-commits first. On conflict with strategy "manual" (default), leaves the working directory in merge state so you can read/edit conflicted files and then call team-resolve_merge_conflicts.',
				inputSchema: {
					type: 'object',
					properties: {
						name: {type: 'string', description: 'The name of the teammate whose work to merge.'},
						strategy: {type: 'string', enum: ['manual', 'theirs', 'ours'], description: '"manual" (default): pause on conflicts for you to resolve. "theirs": auto-accept all teammate changes on conflict. "ours": auto-keep main branch changes on conflict.'},
					},
					required: ['name'],
				},
			},
			{
				name: 'merge_all_teammate_work',
				description: 'Merge ALL teammates\' branches sequentially. Stops on first conflict (in "manual" mode) so you can resolve it. MUST call before cleanup_team.',
				inputSchema: {
					type: 'object',
					properties: {
						strategy: {type: 'string', enum: ['manual', 'theirs', 'ours'], description: '"manual" (default): stop on conflicts for resolution. "theirs": auto-accept teammate changes. "ours": auto-keep main branch.'},
					},
					required: [],
				},
			},
			{
				name: 'resolve_merge_conflicts',
				description: 'Complete a merge after manually resolving conflicts. Stages all changes and commits. Call this after editing conflicted files to remove <<<<<<< / ======= / >>>>>>> markers.',
				inputSchema: {
					type: 'object',
					properties: {},
					required: [],
				},
			},
			{
				name: 'abort_merge',
				description: 'Abort the current merge and restore the working directory to pre-merge state. Use when you decide not to merge a teammate\'s conflicting changes.',
				inputSchema: {
					type: 'object',
					properties: {},
					required: [],
				},
			},
			{
				name: 'cleanup_team',
				description: 'Clean up the team: remove Git worktrees and disband. All teammates must be shut down AND their work must be merged first (will refuse if unmerged changes exist).',
				inputSchema: {
					type: 'object',
					properties: {},
					required: [],
				},
			},
			{
				name: 'approve_plan',
				description: 'Approve or reject a teammate\'s implementation plan. Only applicable when the teammate was spawned with require_plan_approval.',
				inputSchema: {
					type: 'object',
					properties: {
						target_id: {type: 'string', description: 'The member ID or name of the teammate whose plan to review.'},
						approved: {type: 'boolean', description: 'Whether to approve the plan.'},
						feedback: {type: 'string', description: 'Optional feedback, especially useful when rejecting.'},
					},
					required: ['target_id', 'approved'],
				},
			},
		];
	}
}

export const teamService = new TeamService();

export function getTeamMCPTools(): Array<{
	name: string;
	description: string;
	inputSchema: any;
}> {
	return teamService.getTools();
}
