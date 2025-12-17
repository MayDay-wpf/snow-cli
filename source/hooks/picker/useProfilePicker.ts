import {useState, useCallback} from 'react';
import {getAllProfiles} from '../../utils/config/configManager.js';
import type {ConfigProfile} from '../../utils/config/configManager.js';

export function useProfilePicker() {
	const [selectedIndex, setSelectedIndex] = useState(0);

	// Get all available profiles
	const getProfiles = useCallback((): ConfigProfile[] => {
		return getAllProfiles();
	}, []);

	// Get filtered profiles (for future search functionality)
	const getFilteredProfiles = useCallback((): ConfigProfile[] => {
		return getProfiles();
	}, [getProfiles]);

	return {
		selectedIndex,
		setSelectedIndex,
		getProfiles,
		getFilteredProfiles,
	};
}
