import anyTest, {type TestFn} from 'ava';

import {
	getDefaultUserAgent,
	getPackageVersion,
	getVersionHeader,
	mergeApiRequestHeaders,
} from '../utils/core/version.js';

const test = anyTest as unknown as TestFn;

test('getDefaultUserAgent uses snow-cli/<version> (cli) format', t => {
	const version = getPackageVersion();
	t.is(getDefaultUserAgent(), `snow-cli/${version} (cli)`);
});

test('mergeApiRequestHeaders injects default User-Agent when custom headers are empty', t => {
	const headers = mergeApiRequestHeaders({
		'Content-Type': 'application/json',
		Authorization: 'Bearer test',
	});

	t.is(headers['User-Agent'], getDefaultUserAgent());
	t.is(headers['x-snow'], getVersionHeader());
	t.is(headers['Content-Type'], 'application/json');
	t.is(headers['Authorization'], 'Bearer test');
});

test('mergeApiRequestHeaders does not inject default User-Agent when custom headers exist', t => {
	const headers = mergeApiRequestHeaders(
		{
			'Content-Type': 'application/json',
		},
		{
			'X-App': 'cli',
			'User-Agent': 'claude-cli/1.0.83 (external, cli)',
		},
	);

	t.is(headers['User-Agent'], 'claude-cli/1.0.83 (external, cli)');
	t.is(headers['X-App'], 'cli');
	t.is(headers['x-snow'], getVersionHeader());
	t.false(
		Object.values(headers).includes(getDefaultUserAgent()) &&
			headers['User-Agent'] === getDefaultUserAgent(),
	);
});

test('mergeApiRequestHeaders allows custom headers to override x-snow', t => {
	const headers = mergeApiRequestHeaders(
		{
			'Content-Type': 'application/json',
		},
		{
			'x-snow': 'custom-version',
		},
	);

	t.is(headers['x-snow'], 'custom-version');
	t.is(headers['User-Agent'], undefined);
});
