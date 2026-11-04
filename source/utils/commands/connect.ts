import {
	loadConnectConfig,
	maskSecret,
	saveConnectConfig,
} from '../connect/store.js';
import {connectService} from '../connect/service.js';
import type {ConnectConfig, ConnectSnapshot} from '../connect/types.js';
import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';

function statusText(snapshot: ConnectSnapshot): string {
	const {config, state, runtime} = snapshot;
	const telegramState = config.telegram.token
		? `Token ${maskSecret(config.telegram.token)}`
		: '未配置 Token';
	const feishuState = config.feishu.appSecret
		? `Secret ${maskSecret(config.feishu.appSecret)}`
		: '未配置 Secret';
	const telegramBindings = Object.keys(runtime.bindings).filter(key =>
		key.startsWith('telegram:'),
	).length;
	const feishuBindings = Object.keys(runtime.bindings).filter(key =>
		key.startsWith('feishu:'),
	).length;

	return [
		'IM Connect 状态',
		`Telegram：${config.telegram.enabled ? '已启用' : '已停用'} / ${
			state.telegram.status
		} / ${telegramState} / 绑定 ${telegramBindings}`,
		`飞书：${config.feishu.enabled ? '已启用' : '已停用'} / ${
			state.feishu.status
		} / ${feishuState} / 绑定 ${feishuBindings}`,
		`工作目录：${config.workingDirectory || process.cwd()}`,
		state.telegram.detail ? `Telegram 详情：${state.telegram.detail}` : '',
		state.feishu.detail ? `飞书详情：${state.feishu.detail}` : '',
		'',
		'使用 /connect 打开配置面板。',
	]
		.filter(Boolean)
		.join('\n');
}

registerCommand('connect', {
	execute: async (args?: string): Promise<CommandResult> => {
		const subcommand = String(args ?? '')
			.trim()
			.toLowerCase();
		const config = await loadConnectConfig();

		if (!subcommand || subcommand === 'panel' || subcommand === 'open') {
			return {
				success: true,
				action: 'showConnectPanel',
			};
		}

		if (subcommand === 'status') {
			return {
				success: true,
				message: statusText(await connectService.getSnapshot()),
			};
		}

		if (subcommand === 'on' || subcommand === 'off') {
			const enabled = subcommand === 'on';
			const next: ConnectConfig = {
				...config,
				telegram: {
					...config.telegram,
					enabled: enabled && Boolean(config.telegram.token),
				},
				feishu: {
					...config.feishu,
					enabled:
						enabled && Boolean(config.feishu.appId && config.feishu.appSecret),
				},
			};
			await saveConnectConfig(next);
			if (enabled) {
				await connectService.start();
			}
			await connectService.refreshNow();
			const anyEnabled = next.telegram.enabled || next.feishu.enabled;
			return {
				success: true,
				message: enabled
					? anyEnabled
						? 'IM Connect 已启用（仅启用已配置凭据的渠道）。'
						: '没有可启用的渠道：请先在 /connect 面板中填写 Bot Token 或飞书 App ID / App Secret。'
					: 'IM Connect 已停用。',
			};
		}

		return {
			success: false,
			message: '用法：/connect [status|on|off]。不带参数打开配置面板。',
		};
	},
});

export default {};
