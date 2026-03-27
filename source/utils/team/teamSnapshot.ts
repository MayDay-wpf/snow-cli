/**
 * Team Snapshot Manager
 * Tracks team creation and member spawning events per (sessionId, messageIndex)
 * so that conversation rollback can clean up team state (worktrees, tracker, etc.)
 *
 * Follows the same pattern as notebook snapshot tracking in notebookManager.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {getProjectId} from '../session/projectUtils.js';

// ── Types ──

export type TeamSnapshotEvent =
	| {type: 'team_created'; teamName: string}
	| {type: 'member_spawned'; teamName: string; memberId: string; memberName: string; worktreePath: string};

interface TeamSnapshotData {
	[key: string]: TeamSnapshotEvent[];
}

// ── File I/O ──

function getTeamSnapshotDir(): string {
	return path.join(os.homedir(), '.snow', 'team-snapshots');
}

function getTeamSnapshotFilePath(): string {
	const projectId = getProjectId();
	return path.join(getTeamSnapshotDir(), `${projectId}.json`);
}

function ensureDir(): void {
	const dir = getTeamSnapshotDir();
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, {recursive: true});
	}
}

function readSnapshotData(): TeamSnapshotData {
	const filePath = getTeamSnapshotFilePath();
	if (!fs.existsSync(filePath)) return {};
	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as TeamSnapshotData;
	} catch {
		return {};
	}
}

function saveSnapshotData(data: TeamSnapshotData): void {
	ensureDir();
	try {
		fs.writeFileSync(getTeamSnapshotFilePath(), JSON.stringify(data, null, 2), 'utf-8');
	} catch (error) {
		console.error('Failed to save team snapshot data:', error);
	}
}

// ── Public API ──

export function recordTeamCreated(
	sessionId: string,
	messageIndex: number,
	teamName: string,
): void {
	const data = readSnapshotData();
	const key = `${sessionId}:${messageIndex}`;
	if (!data[key]) data[key] = [];
	const already = data[key].some(
		e => e.type === 'team_created' && e.teamName === teamName,
	);
	if (!already) {
		data[key].push({type: 'team_created', teamName});
		saveSnapshotData(data);
	}
}

export function recordMemberSpawned(
	sessionId: string,
	messageIndex: number,
	teamName: string,
	memberId: string,
	memberName: string,
	worktreePath: string,
): void {
	const data = readSnapshotData();
	const key = `${sessionId}:${messageIndex}`;
	if (!data[key]) data[key] = [];
	data[key].push({type: 'member_spawned', teamName, memberId, memberName, worktreePath});
	saveSnapshotData(data);
}

/**
 * Get all team snapshot events at or after the target message index.
 */
export function getTeamEventsToRollback(
	sessionId: string,
	targetMessageIndex: number,
): TeamSnapshotEvent[] {
	const data = readSnapshotData();
	const events: TeamSnapshotEvent[] = [];
	for (const [key, ops] of Object.entries(data)) {
		if (!key.startsWith(`${sessionId}:`)) continue;
		const msgIndex = parseInt(key.split(':')[1] || '', 10);
		if (!isNaN(msgIndex) && msgIndex >= targetMessageIndex) {
			events.push(...ops);
		}
	}
	return events;
}

/**
 * Count distinct members spawned at or after the target index (for UI display).
 */
export function getTeamRollbackCount(
	sessionId: string,
	targetMessageIndex: number,
): number {
	const events = getTeamEventsToRollback(sessionId, targetMessageIndex);
	return events.filter(e => e.type === 'member_spawned').length;
}

/**
 * Check whether there is any active team state to clean up at or after the target index.
 * Returns true if there's a team_created or member_spawned event.
 */
export function hasTeamToRollback(
	sessionId: string,
	targetMessageIndex: number,
): boolean {
	return getTeamEventsToRollback(sessionId, targetMessageIndex).length > 0;
}

/**
 * Perform team rollback: abort teammates, clean up worktrees, clear tracker, delete snapshot records.
 * This is a "force" cleanup — all team work is discarded.
 */
export async function rollbackTeamState(
	sessionId: string,
	targetMessageIndex: number,
): Promise<number> {
	const events = getTeamEventsToRollback(sessionId, targetMessageIndex);
	if (events.length === 0) return 0;

	const {teamTracker} = await import('../execution/teamTracker.js');
	const {cleanupTeamWorktrees} = await import('./teamWorktree.js');
	const {disbandTeam} = await import('./teamConfig.js');

	// Abort all running teammates
	teamTracker.abortAllTeammates();

	// Collect unique team names from events
	const teamNames = new Set<string>();
	for (const event of events) {
		teamNames.add(event.teamName);
	}

	// Also include this session's own active team (may not be in snapshots if created in same turn)
	const ownTeamName = teamTracker.getActiveTeamName();
	if (ownTeamName) {
		teamNames.add(ownTeamName);
	}

	let cleanedCount = 0;

	for (const teamName of teamNames) {
		try {
			await cleanupTeamWorktrees(teamName);
			cleanedCount++;
		} catch (error) {
			console.error(`Failed to cleanup worktrees for team ${teamName}:`, error);
		}
		try {
			disbandTeam(teamName);
		} catch {
			// May already be disbanded
		}
	}

	teamTracker.clearActiveTeam();

	const {clearAllTeammateStreamEntries} = await import(
		'../../hooks/conversation/core/subAgentMessageHandler.js'
	);
	clearAllTeammateStreamEntries();

	// Delete snapshot records from target index onward
	deleteTeamSnapshotsFromIndex(sessionId, targetMessageIndex);

	return cleanedCount;
}

/**
 * Delete team snapshot records from the target index onward.
 */
export function deleteTeamSnapshotsFromIndex(
	sessionId: string,
	targetMessageIndex: number,
): void {
	const data = readSnapshotData();
	let changed = false;
	for (const key of Object.keys(data)) {
		if (!key.startsWith(`${sessionId}:`)) continue;
		const msgIndex = parseInt(key.split(':')[1] || '', 10);
		if (!isNaN(msgIndex) && msgIndex >= targetMessageIndex) {
			delete data[key];
			changed = true;
		}
	}
	if (changed) saveSnapshotData(data);
}

/**
 * Delete all team snapshot events for a specific team name within a session.
 * Called when the main flow terminates a team via cleanup_team,
 * so the rollback prompt no longer shows already-cleaned-up teams.
 */
export function deleteTeamSnapshotsByTeamName(
	sessionId: string,
	teamName: string,
): void {
	const data = readSnapshotData();
	let changed = false;
	for (const key of Object.keys(data)) {
		if (!key.startsWith(`${sessionId}:`)) continue;
		const events = data[key];
		if (!events) continue;
		const filtered = events.filter(e => e.teamName !== teamName);
		if (filtered.length !== events.length) {
			changed = true;
			if (filtered.length === 0) {
				delete data[key];
			} else {
				data[key] = filtered;
			}
		}
	}
	if (changed) saveSnapshotData(data);
}

/**
 * Clear all team snapshot records for a session.
 */
export function clearAllTeamSnapshots(sessionId: string): void {
	const data = readSnapshotData();
	let changed = false;
	for (const key of Object.keys(data)) {
		if (key.startsWith(`${sessionId}:`)) {
			delete data[key];
			changed = true;
		}
	}
	if (changed) saveSnapshotData(data);
}
