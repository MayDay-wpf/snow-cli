import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {getTuiMode, setTuiMode, type TuiMode} from '../config/themeConfig.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';

function getMessages() {
	const currentLanguage = getCurrentLanguage();
	return translations[currentLanguage].commandPanel.commandOutput.tuiMode;
}

function parseTarget(arg: string | undefined): TuiMode | 'status' | 'toggle' {
	switch (arg) {
		case 'status': {
			return 'status';
		}

		case 'fullscreen':
		case 'full':
		case 'on': {
			return 'fullscreen';
		}

		case 'classic':
		case 'inline':
		case 'off': {
			return 'classic';
		}

		default: {
			return 'toggle';
		}
	}
}

// TUI render mode command
// Usage:
//   /tui              - Toggle classic <-> full-screen
//   /tui fullscreen   - Switch to full-screen TUI (alias: full / on)
//   /tui classic      - Switch to classic inline mode (alias: inline / off)
//   /tui status       - Show current mode
//
// Returns the toggleTui action so useCommandHandler can clear the screen and
// remount the conversation tree under the new renderer.
registerCommand('tui', {
	execute: (args?: string): CommandResult => {
		const messages = getMessages();
		const current = getTuiMode();
		const target = parseTarget(args?.trim().toLowerCase());

		if (target === 'status') {
			return {
				success: true,
				message:
					current === 'fullscreen'
						? messages.statusFullscreen
						: messages.statusClassic,
			};
		}

		const next: TuiMode =
			target === 'toggle'
				? current === 'fullscreen'
					? 'classic'
					: 'fullscreen'
				: target;
		const message =
			next === 'fullscreen' ? messages.fullscreen : messages.classic;

		if (next === current) {
			return {success: true, message};
		}

		setTuiMode(next);
		return {success: true, action: 'toggleTui', message};
	},
});

export default {};
