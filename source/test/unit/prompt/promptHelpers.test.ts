import test from 'ava';
import {
	getSystemEnvironmentInfo,
	getCurrentTimeInfo,
	detectWindowsPowerShell,
} from '../../../prompt/shared/promptHelpers.js';

test('getSystemEnvironmentInfo renders platform, shell, and working directory', t => {
	const info = getSystemEnvironmentInfo(true);
	t.true(info.includes('Platform:'));
	t.true(info.includes('Shell:'));
	t.true(info.includes('Working Directory:'));
	t.true(info.includes(process.cwd()));
});

test('getCurrentTimeInfo returns formatted YYYY-MM-DD date string', t => {
	const time = getCurrentTimeInfo();
	t.truthy(time.date);
	t.regex(time.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('detectWindowsPowerShell identifies powershell environment from module path', t => {
	const original = process.env['PSModulePath'];

	try {
		process.env['PSModulePath'] = 'C:\\Program Files\\PowerShell\\7\\Modules';
		t.is(detectWindowsPowerShell(), 'pwsh');

		process.env['PSModulePath'] = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules';
		t.is(detectWindowsPowerShell(), 'powershell');

		delete process.env['PSModulePath'];
		t.is(detectWindowsPowerShell(), null);
	} finally {
		if (original !== undefined) {
			process.env['PSModulePath'] = original;
		} else {
			delete process.env['PSModulePath'];
		}
	}
});
