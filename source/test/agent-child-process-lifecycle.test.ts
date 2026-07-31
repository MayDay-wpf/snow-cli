import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import anyTest, {type TestFn} from 'ava';
import ts from 'typescript';

const test = anyTest as unknown as TestFn;

function parseSource(relativeUrl: string): ts.SourceFile {
	const filePath = fileURLToPath(new URL(relativeUrl, import.meta.url));
	const text = fs.readFileSync(filePath, 'utf8');
	return ts.createSourceFile(
		filePath,
		text,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
}

function findFunction(
	source: ts.SourceFile,
	name: string,
): ts.FunctionDeclaration {
	const declaration = source.statements.find(
		(node): node is ts.FunctionDeclaration =>
			ts.isFunctionDeclaration(node) && node.name?.text === name,
	);
	if (!declaration) throw new Error(`Function not found: ${name}`);
	return declaration;
}

// These characterization tests inspect lifecycle contracts without launching a real
// Snow worker, so they cannot signal unrelated Node.js processes.
test('agent fork is outside ProcessManager tracking', t => {
	const source = parseSource('../utils/execution/agentChildProcess.ts');
	const body = findFunction(source, 'runAgentChildProcess').getText(source);

	t.regex(body, /\bfork\s*\(/);
	t.notRegex(body, /\bprocessManager\s*\.\s*register\s*\(/);
	t.notRegex(source.getFullText(), /from\s+['"].*processManager\.js['"]/);
});

test('parent has no ready or overall execution watchdog', t => {
	const source = parseSource('../utils/execution/agentChildProcess.ts');
	const body = findFunction(source, 'runAgentChildProcess').getText(source);

	t.regex(body, /raw\.type === 'ready'/);
	t.regex(body, /raw\.type === 'result'/);
	t.regex(body, /raw\.type === 'error'/);
	t.regex(body, /abortKillTimer\s*=\s*setTimeout/);
	t.notRegex(
		body,
		/readyTimeout|startupTimeout|executionTimeout|resultTimeout/,
	);
});

test('worker start wait has no timeout or disconnect settlement', t => {
	const source = parseSource('../utils/execution/agentChildProcessWorker.ts');
	const body = findFunction(source, 'runAgentChildProcessWorker').getText(
		source,
	);

	t.regex(body, /type: 'ready'/);
	t.regex(body, /type !== 'start'/);
	t.notRegex(body, /process\.(?:on|once)\('disconnect'/);
	t.notRegex(body, /\bsetTimeout\s*\(/);
});

test('parent request has no timeout, abort, or disconnect rejection', t => {
	const source = parseSource('../utils/execution/agentChildProcessWorker.ts');
	const body = findFunction(source, 'requestParent').getText(source);

	t.regex(body, /pendingRequests\.set/);
	t.notRegex(body, /\bsetTimeout\s*\(/);
	t.notRegex(body, /disconnect/);
	t.notRegex(body, /abort/i);
});

test('terminal result acknowledgement has bounded fallbacks as a control', t => {
	const source = parseSource('../utils/execution/agentChildProcessWorker.ts');
	const body = findFunction(source, 'sendAndWaitForAck').getText(source);

	t.regex(body, /setTimeout\(finish,\s*5000\)/);
	t.regex(body, /process\.on\('disconnect'/);
});
