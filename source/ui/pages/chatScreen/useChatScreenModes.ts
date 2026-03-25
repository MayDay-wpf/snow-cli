import {useEffect, useState} from 'react';
import {configEvents} from '../../../utils/config/configEvents.js';
import {getOpenAiConfig} from '../../../utils/config/apiConfig.js';
import {
	getToolSearchEnabled,
	setToolSearchEnabled as persistToolSearchEnabled,
	getYoloMode,
	setYoloMode as persistYoloMode,
	getPlanMode,
	setPlanMode as persistPlanMode,
	getVulnerabilityHuntingMode,
	setVulnerabilityHuntingMode as persistVulnerabilityHuntingMode,
	getHybridCompressEnabled,
	setHybridCompressEnabled as persistHybridCompressEnabled,
	getTeamMode,
	setTeamMode as persistTeamMode,
} from '../../../utils/config/projectSettings.js';
import {getSimpleMode} from '../../../utils/config/themeConfig.js';

type Options = {
	enableYolo?: boolean;
	enablePlan?: boolean;
};

export function useChatScreenModes({enableYolo, enablePlan}: Options) {
	const [yoloMode, setYoloMode] = useState(() => {
		if (enableYolo !== undefined) {
			return enableYolo;
		}

		return getYoloMode();
	});
	const [planMode, setPlanMode] = useState(() => {
		if (enablePlan !== undefined) {
			return enablePlan;
		}

		return getPlanMode();
	});
	const [vulnerabilityHuntingMode, setVulnerabilityHuntingMode] = useState(() =>
		getVulnerabilityHuntingMode(),
	);
	const [toolSearchDisabled, setToolSearchDisabled] = useState(
		() => !getToolSearchEnabled(),
	);
	const [hybridCompressEnabled, setHybridCompressEnabled] = useState(
		() => getHybridCompressEnabled(),
	);
	const [teamMode, setTeamMode] = useState(() => getTeamMode());
	const [simpleMode, setSimpleMode] = useState(() => getSimpleMode());
	const [showThinking, setShowThinking] = useState(() => {
		const config = getOpenAiConfig();
		return config.showThinking !== false;
	});

	useEffect(() => {
		persistYoloMode(yoloMode);
	}, [yoloMode]);

	useEffect(() => {
		persistPlanMode(planMode);
	}, [planMode]);

	useEffect(() => {
		persistVulnerabilityHuntingMode(vulnerabilityHuntingMode);
	}, [vulnerabilityHuntingMode]);

	useEffect(() => {
		persistToolSearchEnabled(!toolSearchDisabled);
	}, [toolSearchDisabled]);

	useEffect(() => {
		persistHybridCompressEnabled(hybridCompressEnabled);
	}, [hybridCompressEnabled]);

	useEffect(() => {
		persistTeamMode(teamMode);
	}, [teamMode]);

	useEffect(() => {
		const interval = setInterval(() => {
			const currentSimpleMode = getSimpleMode();
			if (currentSimpleMode !== simpleMode) {
				setSimpleMode(currentSimpleMode);
			}
		}, 1000);

		return () => clearInterval(interval);
	}, [simpleMode]);

	useEffect(() => {
		const handleConfigChange = (event: {type: string; value: any}) => {
			if (event.type === 'showThinking') {
				setShowThinking(event.value);
			}
		};

		configEvents.onConfigChange(handleConfigChange);

		return () => {
			configEvents.removeConfigChangeListener(handleConfigChange);
		};
	}, []);

	return {
		yoloMode,
		setYoloMode,
		planMode,
		setPlanMode,
		vulnerabilityHuntingMode,
		setVulnerabilityHuntingMode,
		toolSearchDisabled,
		setToolSearchDisabled,
		hybridCompressEnabled,
		setHybridCompressEnabled,
		teamMode,
		setTeamMode,
		simpleMode,
		showThinking,
	};
}
