import {useEffect, useRef, useState} from 'react';
import {configEvents} from '../../../utils/config/configEvents.js';
import {getSnowConfig} from '../../../utils/config/apiConfig.js';
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
	getImageCompressEnabled,
	setImageCompressEnabled as persistImageCompressEnabled,
	getTeamMode,
	setTeamMode as persistTeamMode,
	getUltraTodoEnabled,
	setUltraTodoEnabled as persistUltraTodoEnabled,
	getSpeedometerEnabled,
} from '../../../utils/config/projectSettings.js';
import {tpsTracker} from '../../../hooks/conversation/core/tpsTracker.js';
import {getSimpleMode} from '../../../utils/config/themeConfig.js';
import {getToolDisplayMode} from '../../../utils/config/themeConfig.js';
import type {ToolDisplayMode} from '../../../utils/config/themeConfig.js';
import {getThinkDisplayMode} from '../../../utils/config/themeConfig.js';
import type {ThinkDisplayMode} from '../../../utils/config/themeConfig.js';
import {getSubAgentDisplayMode} from '../../../utils/config/themeConfig.js';
import type {SubAgentDisplayMode} from '../../../utils/config/themeConfig.js';

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
	const [hybridCompressEnabled, setHybridCompressEnabled] = useState(() =>
		getHybridCompressEnabled(),
	);
	const [imageCompressEnabled, setImageCompressEnabled] = useState(() =>
		getImageCompressEnabled(),
	);
	const [teamMode, setTeamMode] = useState(() => getTeamMode());
	const [ultraTodoEnabled, setUltraTodoEnabled] = useState(() =>
		getUltraTodoEnabled(),
	);
	const [simpleMode, setSimpleMode] = useState(() => getSimpleMode());
	const [showThinking, setShowThinking] = useState(() => {
		const config = getSnowConfig();
		return config.showThinking !== false;
	});
	const [toolDisplayMode, setToolDisplayMode] = useState<ToolDisplayMode>(() =>
		getToolDisplayMode(),
	);
	const [thinkDisplayMode, setThinkDisplayMode] = useState<ThinkDisplayMode>(
		() => getThinkDisplayMode(),
	);
	const [subAgentDisplayMode, setSubAgentDisplayMode] =
		useState<SubAgentDisplayMode>(() => getSubAgentDisplayMode());

	useEffect(() => {
		persistYoloMode(yoloMode);
	}, [yoloMode]);

	// Track previous planMode so we only reset the gate on real toggles,
	// not on mount/remount (which would wipe an already-approved session).
	const previousPlanModeRef = useRef<boolean | null>(null);
	useEffect(() => {
		persistPlanMode(planMode);
		const previous = previousPlanModeRef.current;
		previousPlanModeRef.current = planMode;
		if (previous === null || previous === planMode) {
			return;
		}
		// Entering or leaving Plan Mode always requires a fresh approval.
		try {
			const {
				onPlanModeChange,
			} = require('../../../utils/execution/planModeGate.js');
			const {
				sessionManager,
			} = require('../../../utils/session/sessionManager.js');
			onPlanModeChange(planMode, sessionManager.getCurrentSession()?.id);
		} catch {
			// ignore if modules unavailable during early boot
		}
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
		persistImageCompressEnabled(imageCompressEnabled);
	}, [imageCompressEnabled]);

	useEffect(() => {
		persistTeamMode(teamMode);
	}, [teamMode]);

	useEffect(() => {
		persistUltraTodoEnabled(ultraTodoEnabled);
	}, [ultraTodoEnabled]);

	// 启动时从持久化设置恢复测速仪状态
	useEffect(() => {
		if (getSpeedometerEnabled()) {
			tpsTracker.start();
		}
	}, []);

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
			} else if (event.type === 'simpleMode') {
				// /simple 命令切换后通过事件即时同步 React state，
				// 避免 1s 轮询造成 ChatHeader 第一次重挂载时仍用旧值。
				setSimpleMode(prev => {
					const next = Boolean(event.value);
					return prev === next ? prev : next;
				});
			} else if (event.type === 'toolDisplayMode') {
				setToolDisplayMode(event.value);
			} else if (event.type === 'thinkDisplayMode') {
				setThinkDisplayMode(event.value);
			} else if (event.type === 'subAgentDisplayMode') {
				setSubAgentDisplayMode(event.value);
			} else if (event.type === 'yoloMode') {
				setYoloMode(prev => {
					const next = Boolean(event.value);
					return prev === next ? prev : next;
				});
			} else if (event.type === 'planMode') {
				setPlanMode(prev => {
					const next = Boolean(event.value);
					return prev === next ? prev : next;
				});
			} else if (event.type === 'teamMode') {
				setTeamMode(prev => {
					const next = Boolean(event.value);
					return prev === next ? prev : next;
				});
			} else if (event.type === 'vulnerabilityHuntingMode') {
				setVulnerabilityHuntingMode(prev => {
					const next = Boolean(event.value);
					return prev === next ? prev : next;
				});
			} else if (event.type === 'toolSearchEnabled') {
				setToolSearchDisabled(prev => {
					const next = !Boolean(event.value);
					return prev === next ? prev : next;
				});
			} else if (event.type === 'ultraTodoEnabled') {
				setUltraTodoEnabled(prev => {
					const next = Boolean(event.value);
					return prev === next ? prev : next;
				});
			} else if (event.type === 'imageCompressEnabled') {
				setImageCompressEnabled(prev => {
					const next = Boolean(event.value);
					return prev === next ? prev : next;
				});
			} else if (event.type === 'hybridCompressEnabled') {
				setHybridCompressEnabled(prev => {
					const next = Boolean(event.value);
					return prev === next ? prev : next;
				});
			} else if (event.type === 'speedometerEnabled') {
				// Tracker start/stop already happened in the control-plane setter.
				// Keep React subscribers in sync for any future UI that reads this flag.
				if (event.value) {
					if (!tpsTracker.isActive()) {
						tpsTracker.start();
					}
				} else if (tpsTracker.isActive()) {
					tpsTracker.stop();
				}
			} else if (event.type === 'telemetryEnabled') {
				// Status line currently reads isTelemetryActive() each render;
				// force a cheap remount-safe noop by touching image compress state
				// is unnecessary. Leave handled for consumers that may subscribe.
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
		imageCompressEnabled,
		setImageCompressEnabled,
		teamMode,
		setTeamMode,
		ultraTodoEnabled,
		setUltraTodoEnabled,
		simpleMode,
		showThinking,
		toolDisplayMode,
		thinkDisplayMode,
		subAgentDisplayMode,
	};
}
