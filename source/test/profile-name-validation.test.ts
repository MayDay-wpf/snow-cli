import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import anyTest, {type TestFn} from 'ava';

const test = anyTest as unknown as TestFn;
const execFileAsync = promisify(execFile);

test('profile names remain portable across Windows and POSIX filesystems', async t => {
	const homeDirectory = await fs.mkdtemp(
		path.join(os.tmpdir(), 'snow-profile-names-'),
	);
	const script = String.raw`
		const path = await import('node:path');
		const {pathToFileURL} = await import('node:url');
		const root = pathToFileURL(process.cwd() + path.sep).href;
		const {createProfile, getAllProfiles} = await import(
			new URL('source/utils/config/configManager.ts', root)
		);
		const invalid = [
			'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b',
			'CON', 'con.prod', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT9', 'trailing.'
		];
		for (const name of invalid) {
			try {
				createProfile(name);
				throw new Error('Accepted invalid profile name: ' + name);
			} catch (error) {
				if (error?.message !== 'Invalid profile name') throw error;
			}
		}
		const valid = [
			'work prod', '研发', 'café', '.hidden', 'foo.bar',
			'CONSOLE', 'COM10', 'LPT0', 'auxiliary'
		];
		for (const name of valid) createProfile(name);
		const profiles = new Set(getAllProfiles().map(profile => profile.name));
		for (const name of valid) {
			if (!profiles.has(name)) throw new Error('Missing valid profile: ' + name);
		}
		console.log('PROFILE_NAMES_OK');
	`;

	try {
		const {stdout} = await execFileAsync(
			process.execPath,
			['--loader=ts-node/esm', '--input-type=module', '--eval', script],
			{
				cwd: process.cwd(),
				env: {
					...process.env,
					HOME: homeDirectory,
					USERPROFILE: homeDirectory,
				},
				timeout: 15_000,
				windowsHide: true,
			},
		);
		t.true(stdout.includes('PROFILE_NAMES_OK'));
	} finally {
		await fs.rm(homeDirectory, {recursive: true, force: true});
	}
});
