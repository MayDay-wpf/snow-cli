import anyTest, {type TestFn} from 'ava';

const test = anyTest as unknown as TestFn;

test('resume completed two-step tools only shows success rows, not live pending', async t => {
	const {convertSessionMessagesToUI} = await import(
		'../utils/session/sessionConverter.js'
	);

	const sessionMessages = [
		{
			role: 'user',
			content: 'run tools',
		},
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{
					id: 'call_term_1',
					type: 'function',
					function: {
						name: 'terminal-execute',
						arguments: JSON.stringify({command: 'echo hi'}),
					},
				},
				{
					id: 'call_edit_1',
					type: 'function',
					function: {
						name: 'filesystem-replaceedit',
						arguments: JSON.stringify({
							filePath: 'a.ts',
							searchContent: 'old',
							replaceContent: 'new',
						}),
					},
				},
			],
		},
		{
			role: 'tool',
			tool_call_id: 'call_term_1',
			content: JSON.stringify({
				stdout: 'hi',
				stderr: '',
				exitCode: 0,
				command: 'echo hi',
			}),
			messageStatus: 'success',
		},
		{
			role: 'tool',
			tool_call_id: 'call_edit_1',
			content: JSON.stringify({
				oldContent: 'old',
				newContent: 'new',
				filePath: 'a.ts',
			}),
			messageStatus: 'success',
			editDiffData: {
				oldContent: 'old',
				newContent: 'new',
				filename: 'a.ts',
			},
		},
	] as any[];

	const uiMessages = convertSessionMessagesToUI(sessionMessages);

	const pendingLive = uiMessages.filter((m: any) => m.toolPending === true);
	t.is(
		pendingLive.length,
		0,
		'resume must not recreate live PendingToolCalls rows for completed tools',
	);

	const successStatuses = uiMessages.filter(
		(m: any) => m.messageStatus === 'success',
	);
	t.true(successStatuses.length >= 2);

	const pendingStatuses = uiMessages.filter(
		(m: any) =>
			m.messageStatus === 'pending' &&
			(m.toolCallId === 'call_term_1' || m.toolCallId === 'call_edit_1'),
	);
	t.is(pendingStatuses.length, 0);
});

test('resume incomplete two-step tool keeps static pending, not live spinner flag', async t => {
	const {convertSessionMessagesToUI} = await import(
		'../utils/session/sessionConverter.js'
	);

	const sessionMessages = [
		{
			role: 'user',
			content: 'run',
		},
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{
					id: 'call_term_incomplete',
					type: 'function',
					function: {
						name: 'terminal-execute',
						arguments: JSON.stringify({command: 'sleep 999'}),
					},
				},
			],
		},
	] as any[];

	const uiMessages = convertSessionMessagesToUI(sessionMessages);
	const pending = uiMessages.filter(
		(m: any) => m.toolCallId === 'call_term_incomplete',
	);
	t.is(pending.length, 1);
	t.is(pending[0]?.messageStatus, 'pending');
	t.false(
		pending[0]?.toolPending === true,
		'historical incomplete tools should not enter live PendingToolCalls',
	);
});
