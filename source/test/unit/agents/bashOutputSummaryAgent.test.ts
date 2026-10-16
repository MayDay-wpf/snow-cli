import test from 'ava';
import {bashOutputSummaryAgent} from '../../../agents/bashOutputSummaryAgent.js';
import type {CommandExecutionResult} from '../../../mcp/types/bash.types.js';

test('bashOutputSummaryAgent summarizes command output into structured briefing', async t => {
	const mockResult: CommandExecutionResult = {
		command: 'git status',
		exitCode: 0,
		stdout: 'On branch main\nnothing to commit, working tree clean',
		stderr: '',
		executedAt: new Date().toISOString(),
	};

	// Isolate from external network / live LLM by stubbing callModel
	const originalCallModel = (bashOutputSummaryAgent as any).callModel;
	(bashOutputSummaryAgent as any).callModel = async () => 'Mocked summarized stdout';

	try {
		const res = await bashOutputSummaryAgent.summarizeCommandResult(mockResult);
		t.is(res.command, mockResult.command);
		t.is(res.exitCode, 0);
		t.truthy(res.stdout);
		t.is(res.stderr, '');
	} finally {
		(bashOutputSummaryAgent as any).callModel = originalCallModel;
	}
});

test('bashOutputSummaryAgent handles already aborted signals gracefully', async t => {
	const controller = new AbortController();
	controller.abort();

	const mockResult: CommandExecutionResult = {
		command: 'npm run test',
		exitCode: 1,
		stdout: '',
		stderr: 'Error: Cannot find module',
		executedAt: new Date().toISOString(),
	};

	const originalCallModel = (bashOutputSummaryAgent as any).callModel;
	(bashOutputSummaryAgent as any).callModel = async (_msg: any, signal?: AbortSignal) => {
		if (signal?.aborted) {
			throw new Error('Request aborted');
		}
		return 'unexpected';
	};

	try {
		const res = await bashOutputSummaryAgent.summarizeCommandResult(
			mockResult,
			controller.signal,
		);
		// On abort exception, agent catches and returns original output
		t.is(res.command, mockResult.command);
		t.is(res.exitCode, 1);
		t.is(res.stderr, 'Error: Cannot find module');
	} finally {
		(bashOutputSummaryAgent as any).callModel = originalCallModel;
	}
});
