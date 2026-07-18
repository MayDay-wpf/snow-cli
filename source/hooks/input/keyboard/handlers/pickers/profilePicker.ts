import type {HandlerContext} from '../../types.js';

export function profilePickerHandler(ctx: HandlerContext): boolean {
	const {input, key, options} = ctx;
	const {
		showProfilePicker,
		getFilteredProfiles,
		setProfileSelectedIndex,
		profileSelectedIndex,
		handleProfileSelect,
		handleProfileEdit,
		profileSearchQuery,
		setProfileSearchQuery,
		triggerUpdate,
	} = options;

	if (!showProfilePicker) return false;
	const filteredProfiles = getFilteredProfiles();

	if (key.upArrow) {
		setProfileSelectedIndex(prev =>
			prev > 0 ? prev - 1 : Math.max(0, filteredProfiles.length - 1),
		);
		return true;
	}

	if (key.downArrow) {
		const maxIndex = Math.max(0, filteredProfiles.length - 1);
		setProfileSelectedIndex(prev => (prev < maxIndex ? prev + 1 : 0));
		return true;
	}

	// Tab 键：打开当前光标焦点 profile 的编辑面板（不切换 active）
	if (key.tab && handleProfileEdit) {
		if (
			filteredProfiles.length > 0 &&
			profileSelectedIndex < filteredProfiles.length
		) {
			const focusedProfile = filteredProfiles[profileSelectedIndex];
			if (focusedProfile) {
				handleProfileEdit(focusedProfile.name);
			}
		}
		return true;
	}

	if (key.return) {
		if (
			filteredProfiles.length > 0 &&
			profileSelectedIndex < filteredProfiles.length
		) {
			const selectedProfile = filteredProfiles[profileSelectedIndex];
			if (selectedProfile) {
				handleProfileSelect(selectedProfile.name);
			}
		}
		return true;
	}

	if (key.backspace || key.delete) {
		if (profileSearchQuery.length > 0) {
			setProfileSearchQuery(profileSearchQuery.slice(0, -1));
			setProfileSelectedIndex(0);
			triggerUpdate();
		}
		return true;
	}

	if (
		input &&
		!key.ctrl &&
		!key.meta &&
		!key.escape &&
		input !== '\x1b' &&
		input !== '\u001b' &&
		!/[\x00-\x1F]/.test(input)
	) {
		setProfileSearchQuery(profileSearchQuery + input);
		setProfileSelectedIndex(0);
		triggerUpdate();
		return true;
	}

	return true;
}
