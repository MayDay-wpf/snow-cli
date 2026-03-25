import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {homedir} from 'os';
import {randomUUID} from 'crypto';

export type TeamMemberStatus = 'pending' | 'active' | 'idle' | 'shutdown';
export type TeamStatus = 'active' | 'cleanup' | 'disbanded';

export interface TeamMember {
	id: string;
	name: string;
	role?: string;
	instanceId?: string;
	worktreePath: string;
	status: TeamMemberStatus;
	spawnedAt?: string;
	shutdownAt?: string;
}

export interface TeamConfig {
	name: string;
	leadInstanceId: string;
	members: TeamMember[];
	createdAt: string;
	status: TeamStatus;
}

const SNOW_DIR = join(homedir(), '.snow');
const TEAMS_DIR = join(SNOW_DIR, 'teams');

function ensureDir(dir: string): void {
	if (!existsSync(dir)) {
		mkdirSync(dir, {recursive: true});
	}
}

function getTeamDir(teamName: string): string {
	return join(TEAMS_DIR, teamName);
}

function getTeamConfigPath(teamName: string): string {
	return join(getTeamDir(teamName), 'config.json');
}

export function createTeam(
	teamName: string,
	leadInstanceId: string,
): TeamConfig {
	const existing = getActiveTeam();
	if (existing) {
		throw new Error(
			`An active team "${existing.name}" already exists. Clean it up before creating a new one.`,
		);
	}

	const teamDir = getTeamDir(teamName);
	ensureDir(teamDir);

	const config: TeamConfig = {
		name: teamName,
		leadInstanceId,
		members: [],
		createdAt: new Date().toISOString(),
		status: 'active',
	};

	writeFileSync(getTeamConfigPath(teamName), JSON.stringify(config, null, 2));
	return config;
}

export function getTeam(teamName: string): TeamConfig | null {
	const configPath = getTeamConfigPath(teamName);
	if (!existsSync(configPath)) {
		return null;
	}
	try {
		return JSON.parse(readFileSync(configPath, 'utf8')) as TeamConfig;
	} catch {
		return null;
	}
}

export function getActiveTeam(): TeamConfig | null {
	ensureDir(TEAMS_DIR);
	try {
		const {readdirSync} = require('fs');
		const entries = readdirSync(TEAMS_DIR, {withFileTypes: true});
		for (const entry of entries) {
			if (entry.isDirectory()) {
				const team = getTeam(entry.name);
				if (team && team.status === 'active') {
					return team;
				}
			}
		}
	} catch {
		// ignore
	}
	return null;
}

export function updateTeam(teamName: string, updates: Partial<TeamConfig>): TeamConfig | null {
	const team = getTeam(teamName);
	if (!team) return null;

	const updated: TeamConfig = {...team, ...updates, name: teamName};
	writeFileSync(getTeamConfigPath(teamName), JSON.stringify(updated, null, 2));
	return updated;
}

export function addMember(
	teamName: string,
	name: string,
	worktreePath: string,
	role?: string,
): TeamMember {
	const team = getTeam(teamName);
	if (!team) {
		throw new Error(`Team "${teamName}" not found`);
	}
	if (team.status !== 'active') {
		throw new Error(`Team "${teamName}" is not active`);
	}

	const member: TeamMember = {
		id: randomUUID().slice(0, 8),
		name,
		role,
		worktreePath,
		status: 'pending',
		spawnedAt: new Date().toISOString(),
	};

	team.members.push(member);
	writeFileSync(getTeamConfigPath(teamName), JSON.stringify(team, null, 2));
	return member;
}

export function updateMember(
	teamName: string,
	memberId: string,
	updates: Partial<Pick<TeamMember, 'status' | 'instanceId' | 'shutdownAt'>>,
): TeamMember | null {
	const team = getTeam(teamName);
	if (!team) return null;

	const member = team.members.find(m => m.id === memberId);
	if (!member) return null;

	Object.assign(member, updates);
	writeFileSync(getTeamConfigPath(teamName), JSON.stringify(team, null, 2));
	return member;
}

export function removeMember(teamName: string, memberId: string): boolean {
	const team = getTeam(teamName);
	if (!team) return false;

	const idx = team.members.findIndex(m => m.id === memberId);
	if (idx === -1) return false;

	team.members.splice(idx, 1);
	writeFileSync(getTeamConfigPath(teamName), JSON.stringify(team, null, 2));
	return true;
}

export function getMember(teamName: string, memberId: string): TeamMember | null {
	const team = getTeam(teamName);
	if (!team) return null;
	return team.members.find(m => m.id === memberId) || null;
}

export function getActiveMembers(teamName: string): TeamMember[] {
	const team = getTeam(teamName);
	if (!team) return [];
	return team.members.filter(
		m => m.status === 'active' || m.status === 'pending',
	);
}

export function disbandTeam(teamName: string): boolean {
	const team = getTeam(teamName);
	if (!team) return false;

	team.status = 'disbanded';
	team.members.forEach(m => {
		if (m.status !== 'shutdown') {
			m.status = 'shutdown';
			m.shutdownAt = new Date().toISOString();
		}
	});

	writeFileSync(getTeamConfigPath(teamName), JSON.stringify(team, null, 2));
	return true;
}

export function deleteTeamData(teamName: string): boolean {
	const teamDir = getTeamDir(teamName);
	if (!existsSync(teamDir)) return false;
	try {
		const {rmSync} = require('fs');
		rmSync(teamDir, {recursive: true, force: true});
		return true;
	} catch {
		return false;
	}
}
