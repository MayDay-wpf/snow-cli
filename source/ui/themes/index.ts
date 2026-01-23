import {existsSync, readFileSync} from 'fs';
import {homedir} from 'os';
import {join} from 'path';

export type ThemeType =
	| 'dark'
	| 'light'
	| 'github-dark'
	| 'rainbow'
	| 'solarized-dark'
	| 'nord'
	| 'custom';

export interface ThemeColors {
	background: string;
	text: string;
	border: string;
	diffAdded: string;
	diffRemoved: string;
	diffModified: string;
	lineNumber: string;
	lineNumberBorder: string;
	// Menu colors
	menuSelected: string;
	menuNormal: string;
	menuInfo: string;
	menuSecondary: string;
	// Status colors
	error: string;
	warning: string;
	success: string;
	cyan: string; // 用于 Bash 代码块高亮
	// Logo gradient colors (3 colors for gradient effect)
	logoGradient: [string, string, string];
	// User message background
	userMessageBackground: string;
}

export const defaultCustomColors: ThemeColors = {
	background: '#1e1e1e',
	text: '#d4d4d4',
	border: '#3e3e3e',
	diffAdded: '#0d4d3d',
	diffRemoved: '#5a1f1f',
	diffModified: '#dcdcaa',
	lineNumber: '#858585',
	lineNumberBorder: '#3e3e3e',
	menuSelected: '#5e0691ff',
	menuNormal: 'white',
	menuInfo: 'cyan',
	menuSecondary: 'gray',
	error: 'red',
	warning: 'yellow',
	success: 'green',
	cyan: 'cyan',
	logoGradient: ['#d3d3d3', '#808080', '#505050'],
	userMessageBackground: '#2a4a2a',
};

function loadCustomThemeColors(): ThemeColors {
	const configPath = join(homedir(), '.snow', 'theme.json');
	if (!existsSync(configPath)) {
		return defaultCustomColors;
	}
	try {
		const data = readFileSync(configPath, 'utf-8');
		const config = JSON.parse(data);
		if (config.customColors) {
			// Ensure backward compatibility: add logoGradient if missing
			const colors = {...defaultCustomColors, ...config.customColors};
			if (!colors.logoGradient) {
				colors.logoGradient = defaultCustomColors.logoGradient;
			}
			return colors;
		}
	} catch {
		// ignore
	}
	return defaultCustomColors;
}

export interface Theme {
	name: string;
	type: ThemeType;
	colors: {
		background: string;
		text: string;
		border: string;
		diffAdded: string;
		diffRemoved: string;
		diffModified: string;
		lineNumber: string;
		lineNumberBorder: string;
		// Menu colors
		menuSelected: string;
		menuNormal: string;
		menuInfo: string;
		menuSecondary: string;
		// Status colors
		error: string;
		warning: string;
		success: string;
		cyan: string;
		// Logo gradient colors
		logoGradient: [string, string, string];
		// User message background
		userMessageBackground: string;
	};
}

export const themes: Record<ThemeType, Theme> = {
	dark: {
		name: 'Dark',
		type: 'dark',
		colors: {
			background: '#1e1e1e',
			text: '#d4d4d4',
			border: '#3e3e3e',
			diffAdded: '#0d4d3d',
			diffRemoved: '#5a1f1f',
			diffModified: '#dcdcaa',
			lineNumber: '#858585',
			lineNumberBorder: '#3e3e3e',
			// Menu colors
			menuSelected: '#930093ff',
			menuNormal: 'white',
			menuInfo: 'cyan',
			menuSecondary: 'gray',
			// Status colors
			error: 'red',
			warning: 'yellow',
			success: 'green',
			cyan: 'cyan',
			// Logo gradient - gray gradient
			logoGradient: ['#d3d3d3', '#808080', '#505050'],
			// User message background - dark green
			userMessageBackground: '#2a4a2a',
		},
	},
	light: {
		name: 'Light',
		type: 'light',
		colors: {
			background: '#ffffff',
			text: '#000000',
			border: '#e0e0e0',
			diffAdded: '#006400',
			diffRemoved: '#8B0000',
			diffModified: '#0000ff',
			lineNumber: '#6e6e6e',
			lineNumberBorder: '#e0e0e0',
			// Menu colors - darker for better visibility
			menuSelected: '#006400',
			menuNormal: '#000000',
			menuInfo: '#0066cc',
			menuSecondary: '#666666',
			// Status colors - darker for better visibility on white background
			error: '#cc0000',
			warning: '#cc6600',
			success: '#006400',
			cyan: '#0066cc',
			// Logo gradient - darker for light theme
			logoGradient: ['#606060', '#404040', '#202020'],
			// User message background - light green
			userMessageBackground: '#d4f1d4',
		},
	},
	'github-dark': {
		name: 'GitHub Dark',
		type: 'github-dark',
		colors: {
			background: '#0d1117',
			text: '#c9d1d9',
			border: '#30363d',
			diffAdded: '#1a4d2e',
			diffRemoved: '#6e1a1a',
			diffModified: '#9e6a03',
			lineNumber: '#6e7681',
			lineNumberBorder: '#21262d',
			// Menu colors
			menuSelected: '#58a6ff',
			menuNormal: '#c9d1d9',
			menuInfo: '#58a6ff',
			menuSecondary: '#8b949e',
			// Status colors
			error: '#f85149',
			warning: '#d29922',
			success: '#3fb950',
			cyan: '#58a6ff',
			// Logo gradient - GitHub blue tones
			logoGradient: ['#58a6ff', '#1f6feb', '#0d419d'],
			// User message background - GitHub dark green
			userMessageBackground: '#1a4d2e',
		},
	},
	rainbow: {
		name: 'Rainbow',
		type: 'rainbow',
		colors: {
			background: '#1a1a2e',
			text: '#ffffff',
			border: '#ff6b9d',
			diffAdded: '#16697a',
			diffRemoved: '#82204a',
			diffModified: '#5f4b8b',
			lineNumber: '#ffa07a',
			lineNumberBorder: '#ff6b9d',
			// Menu colors - vibrant rainbow colors
			menuSelected: '#ff006e',
			menuNormal: '#00f5ff',
			menuInfo: '#ffbe0b',
			menuSecondary: '#8338ec',
			// Status colors - bright and colorful
			error: '#ff006e',
			warning: '#ffbe0b',
			success: '#06ffa5',
			cyan: '#00f5ff',
			// Logo gradient - rainbow colors
			logoGradient: ['#ff006e', '#8338ec', '#00f5ff'],
			// User message background - rainbow green
			userMessageBackground: '#16697a',
		},
	},
	'solarized-dark': {
		name: 'Solarized Dark',
		type: 'solarized-dark',
		colors: {
			background: '#002b36',
			text: '#839496',
			border: '#073642',
			diffAdded: '#0a3d2c',
			diffRemoved: '#5c1f1f',
			diffModified: '#5d4f1a',
			lineNumber: '#586e75',
			lineNumberBorder: '#073642',
			// Menu colors
			menuSelected: '#2aa198',
			menuNormal: '#93a1a1',
			menuInfo: '#268bd2',
			menuSecondary: '#657b83',
			// Status colors
			error: '#dc322f',
			warning: '#b58900',
			success: '#859900',
			cyan: '#2aa198',
			// Logo gradient - Solarized accent colors
			logoGradient: ['#2aa198', '#268bd2', '#6c71c4'],
			// User message background - Solarized green
			userMessageBackground: '#0a3d2c',
		},
	},
	nord: {
		name: 'Nord',
		type: 'nord',
		colors: {
			background: '#2e3440',
			text: '#d8dee9',
			border: '#3b4252',
			diffAdded: '#1d3a2f',
			diffRemoved: '#5c2a2a',
			diffModified: '#5a4d2f',
			lineNumber: '#4c566a',
			lineNumberBorder: '#3b4252',
			// Menu colors
			menuSelected: '#88c0d0',
			menuNormal: '#d8dee9',
			menuInfo: '#81a1c1',
			menuSecondary: '#616e88',
			// Status colors
			error: '#bf616a',
			warning: '#ebcb8b',
			success: '#a3be8c',
			cyan: '#88c0d0',
			// Logo gradient - Nord frost colors
			logoGradient: ['#88c0d0', '#81a1c1', '#5e81ac'],
			// User message background - Nord green
			userMessageBackground: '#1d3a2f',
		},
	},
	custom: {
		name: 'Custom',
		type: 'custom',
		colors: loadCustomThemeColors(),
	},
};

export function getCustomTheme(): Theme {
	return {
		name: 'Custom',
		type: 'custom',
		colors: loadCustomThemeColors(),
	};
}
