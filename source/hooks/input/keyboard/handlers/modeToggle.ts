import type {HandlerContext} from '../types.js';

function cycleModes(ctx: HandlerContext): void {
	const {options} = ctx;
	const {
		yoloMode,
		planMode,
		teamMode: _teamMode,
		setYoloMode,
		setPlanMode,
		setTeamMode,
		setVulnerabilityHuntingMode,
	} = options;

	if (yoloMode && !planMode && !_teamMode) {
		// YOLO only -> YOLO + Plan
		setPlanMode(true);
		setVulnerabilityHuntingMode(false);
		setTeamMode(false);
	} else if (yoloMode && planMode && !_teamMode) {
		// YOLO + Plan -> Plan only
		setYoloMode(false);
	} else if (!yoloMode && planMode && !_teamMode) {
		// Plan only -> YOLO + Team
		setYoloMode(true);
		setPlanMode(false);
		setTeamMode(true);
		setVulnerabilityHuntingMode(false);
	} else if (yoloMode && !planMode && _teamMode) {
		// YOLO + Team -> Team only
		setYoloMode(false);
	} else if (!yoloMode && !planMode && _teamMode) {
		// Team only -> All off
		setTeamMode(false);
	} else {
		// All off -> YOLO only
		setYoloMode(true);
		setPlanMode(false);
		setTeamMode(false);
		setVulnerabilityHuntingMode(false);
	}
}

export function modeToggleHandler(ctx: HandlerContext): boolean {
	const {input, key} = ctx;

	// Shift+Tab - Toggle modes in cycle
	if (key.shift && key.tab) {
		cycleModes(ctx);
		return true;
	}

	// Ctrl+Y - Toggle modes in cycle
	if (key.ctrl && input === 'y') {
		cycleModes(ctx);
		return true;
	}

	return false;
}
