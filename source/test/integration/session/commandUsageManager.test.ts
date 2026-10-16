import test from 'ava';
import {commandUsageManager} from '../../../utils/session/commandUsageManager.js';

test.serial('commandUsageManager records and retrieves usage counts correctly', async t => {
	await commandUsageManager.clearUsage();

	t.is(await commandUsageManager.getUsageCount('/test-cmd'), 0);
	t.is(commandUsageManager.getUsageCountSync('/test-cmd'), 0);

	await commandUsageManager.recordUsage('/test-cmd');
	await commandUsageManager.recordUsage('/test-cmd');
	await commandUsageManager.recordUsage('/other-cmd');

	t.is(await commandUsageManager.getUsageCount('/test-cmd'), 2);
	t.is(commandUsageManager.getUsageCountSync('/test-cmd'), 2);
	t.is(await commandUsageManager.getUsageCount('/other-cmd'), 1);

	const all = await commandUsageManager.getAllUsage();
	t.is(all['/test-cmd'], 2);
	t.is(all['/other-cmd'], 1);

	await commandUsageManager.dispose();
	await commandUsageManager.clearUsage();
});
