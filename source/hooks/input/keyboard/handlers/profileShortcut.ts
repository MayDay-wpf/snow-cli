import type {HandlerContext} from '../types.js';

export function profileShortcutHandler(ctx: HandlerContext): boolean {
	const {input, key, options} = ctx;
	const {onSwitchProfile} = options;

	// Windows/Linux: Alt+P, macOS: Ctrl+P - Switch to next profile
	const isProfileSwitchShortcut =
		process.platform === 'darwin'
			? key.ctrl && input === 'p'
			: key.meta && input === 'p';
	if (isProfileSwitchShortcut) {
		if (onSwitchProfile) {
			onSwitchProfile();
		}
		return true;
	}
	return false;
}
