import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';
import {tpsTracker} from '../../hooks/conversation/core/tpsTracker.js';
import {setSpeedometerEnabled} from '../config/projectSettings.js';

// Get translated messages
function getMessages() {
	const currentLanguage = getCurrentLanguage();
	return translations[currentLanguage].commandPanel.commandOutput.speedometer;
}

// Speedometer command handler - toggle real-time TPS monitoring
// Usage:
//   /speedometer        - Toggle speedometer on/off
//   /speedometer on     - Enable speedometer
//   /speedometer off    - Disable speedometer
//   /speedometer status - Show current status
registerCommand('speedometer', {
	execute: (args?: string): CommandResult => {
		const trimmedArgs = args?.trim().toLowerCase();
		const enabled = tpsTracker.isActive();
		const messages = getMessages();

		if (trimmedArgs === 'status') {
			return {
				success: true,
				message: enabled ? messages.statusEnabled : messages.statusDisabled,
			};
		}

		if (trimmedArgs === 'on') {
			if (!enabled) {
				tpsTracker.start();
				setSpeedometerEnabled(true);
			}
			return {
				success: true,
				action: 'toggleSpeedometer',
				message: messages.enabled,
			};
		}

		if (trimmedArgs === 'off') {
			if (enabled) {
				tpsTracker.stop();
				setSpeedometerEnabled(false);
			}
			return {
				success: true,
				action: 'toggleSpeedometer',
				message: messages.disabled,
			};
		}

		// Toggle
		if (enabled) {
			tpsTracker.stop();
			setSpeedometerEnabled(false);
			return {
				success: true,
				action: 'toggleSpeedometer',
				message: messages.disabled,
			};
		} else {
			tpsTracker.start();
			setSpeedometerEnabled(true);
			return {
				success: true,
				action: 'toggleSpeedometer',
				message: messages.enabled,
			};
		}
	},
});

export default {};
