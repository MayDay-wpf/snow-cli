import anyTest, {type TestFn} from 'ava';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sessionManager, type Session} from '../utils/session/sessionManager.js';

const test = anyTest as unknown as TestFn;

type SessionManagerInternals = {
	sessionsDir: string;
	currentProjectId: string;
	currentProjectPath: string;
	currentProjectRoot: string;
	projectAliasIds: string[];
	sessionListCache: unknown;
	cacheTimestamp: number;
	currentSession: Session | null;
};

function buildSession(
	id: string,
	extra: Record<string, unknown> = {},
): Session {
	return {
		id,
		title: id,
		summary: '',
		createdAt: Date.now(),
		updatedAt: Date.now(),
		messages: [],
		messageCount: 0,
		...extra,
	} as Session;
}

async function writeSession(filePath: string, session: Session): Promise<void> {
	await fs.mkdir(path.dirname(filePath), {recursive: true});
	await fs.writeFile(filePath, JSON.stringify(session), 'utf8');
}

test.serial(
	'legacy sessions require reliable current-project ownership evidence',
	async t => {
		const root = await fs.mkdtemp(
			path.join(os.tmpdir(), 'snow-session-security-'),
		);
		const sessionsDir = path.join(root, 'sessions');
		const projectPath = path.join(root, 'workspace');
		const projectId = 'workspace-abc123';
		const dateFolder = '20260716';
		await fs.mkdir(projectPath, {recursive: true});

		const internals = sessionManager as unknown as SessionManagerInternals;
		const original = {
			sessionsDir: internals.sessionsDir,
			currentProjectId: internals.currentProjectId,
			currentProjectPath: internals.currentProjectPath,
			currentProjectRoot: internals.currentProjectRoot,
			projectAliasIds: internals.projectAliasIds,
			sessionListCache: internals.sessionListCache,
			cacheTimestamp: internals.cacheTimestamp,
			currentSession: internals.currentSession,
		};

		Object.assign(internals, {
			sessionsDir,
			currentProjectId: projectId,
			currentProjectPath: projectPath,
			currentProjectRoot: projectPath,
			projectAliasIds: [],
			sessionListCache: null,
			cacheTimestamp: 0,
			currentSession: null,
		});

		const unownedId = 'legacy-unowned';
		const foreignId = 'legacy-foreign';
		const inferredId = 'legacy-inferred';
		const scopedId = 'legacy-scoped';
		const unownedPath = path.join(sessionsDir, `${unownedId}.json`);

		try {
			await writeSession(unownedPath, buildSession(unownedId));
			await writeSession(
				path.join(sessionsDir, `${foreignId}.json`),
				buildSession(foreignId, {
					workingDirectory: path.join(root, 'other-workspace'),
				}),
			);
			await writeSession(
				path.join(sessionsDir, `${inferredId}.json`),
				buildSession(inferredId, {workingDirectory: projectPath}),
			);
			await writeSession(
				path.join(sessionsDir, projectId, dateFolder, `${scopedId}.json`),
				buildSession(scopedId),
			);

			t.is(await sessionManager.getSessionForExport(unownedId), null);
			t.is(await sessionManager.getSessionForExport(foreignId), null);

			const inferred = await sessionManager.getSessionForExport(inferredId);
			t.is(inferred?.projectId, projectId);
			t.is(inferred?.projectPath, projectPath);

			const scoped = await sessionManager.getSessionForExport(scopedId);
			t.is(scoped?.projectId, projectId);
			t.is(scoped?.projectPath, projectPath);

			const listedIds = (await sessionManager.listSessions()).map(
				item => item.id,
			);
			t.false(listedIds.includes(unownedId));
			t.false(listedIds.includes(foreignId));
			t.true(listedIds.includes(inferredId));
			t.true(listedIds.includes(scopedId));

			t.false(await sessionManager.deleteSession(unownedId));
			t.true(Boolean(await fs.stat(unownedPath)));
		} finally {
			Object.assign(internals, original);
			await fs.rm(root, {recursive: true, force: true});
		}
	},
);
