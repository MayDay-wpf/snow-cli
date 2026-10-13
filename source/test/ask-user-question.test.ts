import anyTest, {type TestFn} from 'ava';
import {mcpTools as askUserTools} from '../mcp/askUserQuestion.js';
import {UserInteractionNeededError} from '../utils/ui/userInteractionError.js';

const test = anyTest as unknown as TestFn;

test('askUserQuestion tool schema includes multiSelect boolean property', t => {
	const askTool = askUserTools.find(
		tool => tool.function.name === 'askuser-ask_question',
	);

	t.truthy(askTool, 'askuser-ask_question tool should exist');
	const params = askTool?.function.parameters as any;
	t.truthy(params, 'Tool parameters should exist');
	t.truthy(params.properties.multiSelect, 'multiSelect property should exist');
	t.is(params.properties.multiSelect.type, 'boolean');
	t.false(
		params.required.includes('multiSelect'),
		'multiSelect should be optional for backward compatibility',
	);
});

test('UserInteractionNeededError correctly preserves multiSelect flag', t => {
	const singleErr = new UserInteractionNeededError(
		'What language?',
		['TypeScript', 'Rust'],
		'call-1',
		false,
	);
	t.is(singleErr.question, 'What language?');
	t.deepEqual(singleErr.options, ['TypeScript', 'Rust']);
	t.is(singleErr.toolCallId, 'call-1');
	t.is(singleErr.multiSelect, false);

	const multiErr = new UserInteractionNeededError(
		'Which features?',
		['Auth', 'Database', 'Logging'],
		'call-2',
		true,
	);
	t.is(multiErr.multiSelect, true);
	t.deepEqual(multiErr.options, ['Auth', 'Database', 'Logging']);

	// Default parameter fallback
	const defaultErr = new UserInteractionNeededError('Pick one', ['A', 'B']);
	t.is(defaultErr.multiSelect, false);
});

test('AbortSignal race simulation resolves safely on abort', async t => {
	const controller = new AbortController();

	const runInteractivePrompt = async (signal: AbortSignal) => {
		if (signal.aborted) {
			return {selected: '', cancelled: true};
		}

		return Promise.race([
			new Promise<{selected: string | string[]; cancelled?: boolean}>(
				() => {
					// Pending promise that gets cancelled by signal
				},
			),
			new Promise<never>((_, reject) => {
				const onAbort = () => reject(new Error('User question aborted'));
				if (signal.aborted) {
					onAbort();
				} else {
					signal.addEventListener('abort', onAbort, {once: true});
				}
			}),
		]).catch(error => {
			if (error.message === 'User question aborted') {
				return {selected: '', cancelled: true};
			}
			throw error;
		});
	};

	// Abort synchronously or immediately
	controller.abort();

	const result = await runInteractivePrompt(controller.signal);
	t.deepEqual(result, {selected: '', cancelled: true});
});
