import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import anyTest, {type TestFn} from 'ava';
import {
	appendPlanEvidence,
	getPlanEvidencePath,
	readPlanEvidence,
} from '../utils/execution/planEvidence.js';

const test = anyTest as unknown as TestFn;

test('plan evidence appends structured immutable attempts', async t => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-evidence-'));
	const planPath = path.join(dir, 'plan.md');
	await Promise.all(
		['failed', 'passed'].map(async (status, index) =>
			appendPlanEvidence(planPath, {
				phase: 1,
				status: status as 'failed' | 'passed',
				startedAt: '2026-07-29T00:00:00.000Z',
				completedAt: `2026-07-29T00:00:0${index + 1}.000Z`,
				durationMs: index + 1,
				phaseChecks: [],
				globalAcceptance: [],
				manualConfirmations: [],
				workspace: {
					available: true,
					changedFiles: [],
					outOfScopeFiles: [],
				},
				summary: status,
			}),
		),
	);

	const evidence = await readPlanEvidence(planPath);
	t.is(evidence.version, 1);
	t.is(evidence.entries.length, 2);
	t.deepEqual(
		evidence.entries.map(entry => entry.status),
		['failed', 'passed'],
	);
	t.true(evidence.entries.every(entry => Boolean(entry.id)));
	await fs.access(getPlanEvidencePath(planPath));
});
