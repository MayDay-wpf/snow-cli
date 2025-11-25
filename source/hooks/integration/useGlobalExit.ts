import {useInput} from 'ink';
import {useState} from 'react';
import {useI18n} from '../../i18n/index.js';

export interface ExitNotification {
	show: boolean;
	message: string;
}

export function useGlobalExit(
	onNotification?: (notification: ExitNotification) => void,
) {
	const {t} = useI18n();
	const [lastCtrlCTime, setLastCtrlCTime] = useState<number>(0);
	const ctrlCTimeout = 1000; // 1 second timeout for double Ctrl+C

	useInput((input, key) => {
		if (key.ctrl && input === 'c') {
			const now = Date.now();
			if (now - lastCtrlCTime < ctrlCTimeout) {
				// Second Ctrl+C within timeout - exit
				process.exit(0);
			} else {
				// First Ctrl+C - show notification
				setLastCtrlCTime(now);
				if (onNotification) {
					onNotification({
						show: true,
						message: t.hooks.pressCtrlCAgain,
					});

					// Hide notification after timeout
					setTimeout(() => {
						onNotification({
							show: false,
							message: '',
						});
					}, ctrlCTimeout);
				}
			}
		}
	});
}
