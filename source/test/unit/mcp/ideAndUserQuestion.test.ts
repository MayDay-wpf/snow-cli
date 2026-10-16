import test from 'ava';
import {
	IdeDiagnosticsMCPService,
	mcpTools as diagnosticsMcpTools,
} from '../../../mcp/ideDiagnostics.js';
import {
	mcpTools as askUserTools,
	type AskUserQuestionArgs,
} from '../../../mcp/askUserQuestion.js';
import type {Diagnostic} from '../../../utils/ui/vscodeConnection.js';

test('askUserQuestion exposes correct MCP tool schema', t => {
	t.is(askUserTools.length, 1);
	const tool = askUserTools[0]!;
	t.is(tool.type, 'function');
	t.is(tool.function.name, 'askuser-ask_question');
	t.deepEqual(tool.function.parameters.required, ['question', 'options']);
	t.is(tool.function.parameters.properties.question.type, 'string');
	t.is(tool.function.parameters.properties.options.type, 'array');

	const mockArgs: AskUserQuestionArgs = {
		question: 'Which model do you want to select?',
		options: ['model-a', 'model-b'],
		multiSelect: false,
	};
	t.is(mockArgs.options.length, 2);
});

test('IdeDiagnosticsMCPService formats empty diagnostics gracefully', t => {
	const service = new IdeDiagnosticsMCPService();
	const formatted = service.formatDiagnostics([], '/path/to/file.ts');
	t.is(formatted, 'No diagnostics found for /path/to/file.ts');
});

test('IdeDiagnosticsMCPService formats diagnostics with grouped severities', t => {
	const service = new IdeDiagnosticsMCPService();
	const diagnostics: Diagnostic[] = [
		{
			severity: 'error',
			line: 10,
			character: 5,
			message: 'Type error: string is not assignable to number',
			source: 'ts',
			code: 'TS2322',
		},
		{
			severity: 'warning',
			line: 20,
			character: 2,
			message: 'Unused variable',
		},
	];

	const formatted = service.formatDiagnostics(diagnostics, 'file.ts');
	t.true(formatted.includes('Total: 1 errors, 1 warnings'));
	t.true(formatted.includes('Line 11, Col 6 [ts] (TS2322)'));
	t.true(formatted.includes('Type error: string is not assignable to number'));
	t.true(formatted.includes('Line 21, Col 3'));
	t.true(formatted.includes('Unused variable'));
});

test('IdeDiagnosticsMCPService throws when IDE is not connected', async t => {
	const service = new IdeDiagnosticsMCPService();
	await t.throwsAsync(
		async () => {
			await service.getDiagnostics('/non/existent/path.ts');
		},
		{message: /IDE connection not available/},
	);
});

test('ideDiagnostics exposes valid MCP schema', t => {
	t.is(diagnosticsMcpTools.length, 1);
	const tool = diagnosticsMcpTools[0]!;
	t.is(tool.name, 'ide-get_diagnostics');
	t.is(tool.inputSchema.type, 'object');
	t.is(tool.inputSchema.properties.filePath.type, 'string');
});
