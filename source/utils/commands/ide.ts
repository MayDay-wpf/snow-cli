import {registerCommand, type CommandResult} from '../execution/commandExecutor.js';
import {vscodeConnection} from '../ui/vscodeConnection.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';

function getMessages() {
	const lang = getCurrentLanguage();
	return translations[lang].commandPanel.commandOutput.ide;
}

function formatUnmatchedIDEs(
	unmatched: Array<{name: string; workspace: string}>,
): string {
	if (unmatched.length === 0) return '';
	const t = getMessages();
	let msg = `\n\n${t.unmatchedIDEs.replace('{count}', String(unmatched.length))}`;
	for (const ide of unmatched) {
		msg += `\n   • ${ide.name}: ${ide.workspace}`;
	}
	return msg;
}

registerCommand('ide', {
	execute: async (): Promise<CommandResult> => {
		const t = getMessages();

		// Toggle: if already connected, disconnect
		if (vscodeConnection.isConnected()) {
			vscodeConnection.stop();
			vscodeConnection.resetReconnectAttempts();
			vscodeConnection.setUserDisconnected(true);

			const {unmatched} = vscodeConnection.getAvailableIDEs();
			return {
				success: true,
				action: 'disconnect',
				message: t.disconnected + formatUnmatchedIDEs(unmatched),
			};
		}

		// Not connected — check workspace match first
		const {matched, unmatched} = vscodeConnection.getAvailableIDEs();

		if (matched.length === 0) {
			return {
				success: false,
				message: t.noAvailableIDEs + formatUnmatchedIDEs(unmatched),
			};
		}

		// Has matching workspace — connect
		vscodeConnection.setUserDisconnected(false);
		try {
			await vscodeConnection.start();
			const connectedIde = matched.find(
				ide => ide.port === vscodeConnection.getPort(),
			);
			const label = connectedIde
				? `${connectedIde.name} (${connectedIde.workspace})`
				: `port ${vscodeConnection.getPort()}`;
			return {
				success: true,
				action: 'info',
				message:
					t.connectedTo.replace('{label}', label) +
					formatUnmatchedIDEs(unmatched),
			};
		} catch (error) {
			const errorMsg =
				error instanceof Error ? error.message : 'Unknown error';
			return {
				success: false,
				message:
					t.connectFailed.replace('{error}', errorMsg) +
					formatUnmatchedIDEs(unmatched),
			};
		}
	},
});

export default {};
