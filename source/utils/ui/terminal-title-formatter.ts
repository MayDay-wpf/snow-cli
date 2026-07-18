const appName = 'Snow CLI';
const defaultProjectName = 'Unknown Project';
const maxProjectNameLength = 24;
const maxSummaryLength = 80;
const controlCharacters = /[\u0000-\u001F\u007F]/g; // eslint-disable-line no-control-regex

export const terminalTitleSpinnerFrames = [
	'⠋',
	'⠙',
	'⠹',
	'⠸',
	'⠼',
	'⠴',
	'⠦',
	'⠧',
	'⠇',
	'⠏',
] as const;
export const terminalTitleFrameCount = terminalTitleSpinnerFrames.length;

type TerminalTitleState = {
	appTitle?: string;
	projectName?: string;
	summary?: string;
	activity?: boolean;
	actionRequired?: boolean;
	animationFrame?: number;
};

function cleanTitlePart(
	value: string | undefined,
	fallback: string,
	maxLength?: number,
): string {
	const cleaned = (value ?? '')
		.replaceAll(controlCharacters, ' ')
		.replaceAll(/\s+/g, ' ')
		.trim();
	const safeValue = cleaned || fallback;

	return maxLength && safeValue.length > maxLength
		? `${safeValue.slice(0, maxLength - 3)}...`
		: safeValue;
}

function getFrameIndex(animationFrame: number): number {
	return Math.trunc(Math.abs(animationFrame)) % terminalTitleFrameCount;
}

function formatActionRequiredPrefix(animationFrame: number): string {
	return getFrameIndex(animationFrame) % 2 === 0
		? '[ ! ] Action Required'
		: '[ . ] Action Required';
}

function formatBaseTitle(appTitle: string | undefined): string {
	const safeAppTitle = cleanTitlePart(appTitle, '');
	return safeAppTitle ? `${appName} - ${safeAppTitle}` : appName;
}

export function formatTerminalTitle({
	appTitle,
	projectName,
	summary,
	actionRequired = false,
	animationFrame = 0,
}: TerminalTitleState): string {
	const safeProjectName = cleanTitlePart(
		projectName,
		defaultProjectName,
		maxProjectNameLength,
	);
	const safeSummary = cleanTitlePart(summary, '', maxSummaryLength);
	const title = `${formatBaseTitle(
		safeSummary || appTitle,
	)} - ${safeProjectName}`;

	if (actionRequired) {
		return `${formatActionRequiredPrefix(animationFrame)} - ${title}`;
	}

	return title;
}
