import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import anyTest, {type TestFn} from 'ava';

const test = anyTest as unknown as TestFn;
const execFileAsync = promisify(execFile);

async function runIsolatedWatcherScenario(
	homeDirectory: string,
	script: string,
): Promise<string> {
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
			timeout: 10_000,
			windowsHide: true,
		},
	);
	return stdout;
}

test('api config watcher survives an atomic replacement during save suppression', async t => {
	const homeDirectory = await fs.mkdtemp(
		path.join(os.tmpdir(), 'snow-api-watch-'),
	);
	const script = String.raw`
		const fs = await import('node:fs/promises');
		const path = await import('node:path');
		const {pathToFileURL} = await import('node:url');
		const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
		const snowDir = path.join(process.env.USERPROFILE, '.snow');
		const configPath = path.join(snowDir, 'config.json');
		const backupPath = path.join(snowDir, 'config.backup.json');
		await fs.mkdir(snowDir, {recursive: true});
		await fs.writeFile(configPath, JSON.stringify({snowcfg: {advancedModel: 'initial'}}));
		const root = pathToFileURL(process.cwd() + path.sep).href;
		const api = await import(new URL('source/utils/config/apiConfig.ts', root));
		const {configEvents} = await import(new URL('source/utils/config/configEvents.ts', root));
		const initial = api.loadConfig();
		const waitForModel = model => new Promise((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Timed out waiting for ' + model)), 4000);
			const listener = event => {
				if (event.type === 'apiConfig' && event.value?.advancedModel === model) {
					clearTimeout(timeout);
					configEvents.removeConfigChangeListener(listener);
					resolve();
				}
			};
			configEvents.onConfigChange(listener);
		});
		const replacementSeen = waitForModel('replacement');
		api.saveConfig({...initial, snowcfg: {...initial.snowcfg, advancedModel: 'internal'}});
		await fs.rename(configPath, backupPath);
		await delay(25);
		await fs.writeFile(configPath, JSON.stringify({snowcfg: {advancedModel: 'replacement'}}));
		await replacementSeen;
		await delay(350);
		const followupSeen = waitForModel('followup');
		await fs.writeFile(configPath, JSON.stringify({snowcfg: {advancedModel: 'followup'}}));
		await followupSeen;
		console.log('WATCHER_OK');
	`;

	try {
		const output = await runIsolatedWatcherScenario(homeDirectory, script);
		t.true(output.includes('WATCHER_OK'));
	} finally {
		await fs.rm(homeDirectory, {recursive: true, force: true});
	}
});

test('theme watcher reloads a file created after its watch target disappears', async t => {
	const homeDirectory = await fs.mkdtemp(
		path.join(os.tmpdir(), 'snow-theme-watch-'),
	);
	const script = String.raw`
		const fs = await import('node:fs/promises');
		const path = await import('node:path');
		const {pathToFileURL} = await import('node:url');
		const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
		const snowDir = path.join(process.env.USERPROFILE, '.snow');
		const themePath = path.join(snowDir, 'theme.json');
		const backupPath = path.join(snowDir, 'theme.backup.json');
		await fs.mkdir(snowDir, {recursive: true});
		await fs.writeFile(themePath, JSON.stringify({theme: 'tiffany', diffOpacity: 1}));
		const root = pathToFileURL(process.cwd() + path.sep).href;
		const {watchThemeConfigFile} = await import(new URL('source/ui/contexts/ThemeContext.tsx', root));
		let resolveReload;
		const reloaded = new Promise(resolve => { resolveReload = resolve; });
		const stopWatching = watchThemeConfigFile(async () => {
			try {
				const config = JSON.parse(await fs.readFile(themePath, 'utf8'));
				if (config.theme === 'dark' && config.diffOpacity === 0.5) resolveReload();
			} catch {}
		});
		await delay(100);
		await fs.rename(themePath, backupPath);
		await delay(250);
		await fs.writeFile(themePath, JSON.stringify({theme: 'dark', diffOpacity: 0.5}));
		await Promise.race([
			reloaded,
			delay(4000).then(() => { throw new Error('Theme watcher did not reload recreated file'); }),
		]);
		stopWatching();
		console.log('THEME_OK');
	`;

	try {
		const output = await runIsolatedWatcherScenario(homeDirectory, script);
		t.true(output.includes('THEME_OK'));
	} finally {
		await fs.rm(homeDirectory, {recursive: true, force: true});
	}
});
