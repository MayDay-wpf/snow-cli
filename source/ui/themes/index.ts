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
	| 'tiffany'
	| 'macaron-pink'
	| 'trump-gold'
	| 'china-red'
	| 'eva-purple'
	| 'custom';

export interface ThemeColors {
	background: string;
	text: string;
	border: string;
	diffAdded: string;
	diffRemoved: string;
	diffModified: string;
	diffAddedForeground: string;
	diffRemovedForeground: string;
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
	// User message text color
	userMessageText: string;
	// Diff highlight opacity (0-1)
	diffOpacity: number;
}

export const defaultCustomColors: ThemeColors = {
	background: '#1e1e1e',
	text: '#d4d4d4',
	border: '#3e3e3e',
	diffAdded: '#033a16',
	diffRemoved: '#67060c',
	diffModified: '#dcdcaa',
	diffAddedForeground: '#7ee787',
	diffRemovedForeground: '#ff7b72',
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
	userMessageText: 'white',
	diffOpacity: 1,
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
		diffAddedForeground: string;
		diffRemovedForeground: string;
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
		// User message text color
		userMessageText: string;
		// Diff highlight opacity (0-1)
		diffOpacity: number;
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
			diffAdded: '#033a16',
			diffRemoved: '#67060c',
			diffModified: '#dcdcaa',
			diffAddedForeground: '#3fb950',
			diffRemovedForeground: '#f85149',
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
			// User message text color
			userMessageText: 'white',
			// Diff highlight opacity
			diffOpacity: 1,
		},
	},
	light: {
		name: 'Light',
		type: 'light',
		colors: {
			background: '#ffffff',
			text: '#000000',
			border: '#e0e0e0',
			diffAdded: '#dff7df',
			diffRemoved: '#ffe2e0',
			diffModified: '#8250df',
			diffAddedForeground: '#116329',
			diffRemovedForeground: '#b42318',
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
			// User message text color
			userMessageText: 'white',
			// Diff highlight opacity
			diffOpacity: 1,
		},
	},
	'github-dark': {
		name: 'GitHub Dark',
		type: 'github-dark',
		colors: {
			background: '#0d1117',
			text: '#c9d1d9',
			border: '#30363d',
			diffAdded: '#033a16',
			diffRemoved: '#67060c',
			diffModified: '#d29922',
			diffAddedForeground: '#3fb950',
			diffRemovedForeground: '#f85149',
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
			// User message text color
			userMessageText: 'white',
			// Diff highlight opacity
			diffOpacity: 1,
		},
	},
	rainbow: {
		name: 'Rainbow',
		type: 'rainbow',
		colors: {
			background: '#1a1a2e',
			text: '#ffffff',
			border: '#ff6b9d',
			diffAdded: '#063f3c',
			diffRemoved: '#4a102f',
			diffModified: '#ffbe0b',
			diffAddedForeground: '#06ffa5',
			diffRemovedForeground: '#ff6b9d',
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
			// User message text color
			userMessageText: 'white',
			// Diff highlight opacity
			diffOpacity: 1,
		},
	},
	'solarized-dark': {
		name: 'Solarized Dark',
		type: 'solarized-dark',
		colors: {
			background: '#002b36',
			text: '#839496',
			border: '#073642',
			diffAdded: '#123c2e',
			diffRemoved: '#4d1f26',
			diffModified: '#b58900',
			diffAddedForeground: '#859900',
			diffRemovedForeground: '#dc322f',
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
			// User message text color
			userMessageText: 'white',
			// Diff highlight opacity
			diffOpacity: 1,
		},
	},
	nord: {
		name: 'Nord',
		type: 'nord',
		colors: {
			background: '#2e3440',
			text: '#d8dee9',
			border: '#3b4252',
			diffAdded: '#033a16',
			diffRemoved: '#67060c',
			diffModified: '#ebcb8b',
			diffAddedForeground: '#116329',
			diffRemovedForeground: '#b42318',
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
			// User message text color
			userMessageText: 'white',
			// Diff highlight opacity
			diffOpacity: 1,
		},
	},
	tiffany: {
		name: 'Tiffany',
		type: 'tiffany',
		colors: {
			background: '#e8f7f5',
			text: '#0a3a38',
			border: '#0abab5',
			diffAdded: '#c8f4ee',
			diffRemoved: '#ffd9d2',
			diffModified: '#0abab5',
			diffAddedForeground: '#007f7a',
			diffRemovedForeground: '#c0392b',
			lineNumber: '#5a8a87',
			lineNumberBorder: '#9bd9d3',
			// Menu colors
			menuSelected: '#0abab5',
			menuNormal: '#0a3a38',
			menuInfo: '#0a8a85',
			menuSecondary: '#5a8a87',
			// Status colors
			error: '#c0392b',
			warning: '#d18a3d',
			success: '#0abab5',
			cyan: '#0abab5',
			// Logo gradient - Tiffany blue tones
			logoGradient: ['#0abab5', '#5fd6d1', '#9bd9d3'],
			// User message background - Tiffany pale
			userMessageBackground: '#bfe7e3',
			// User message text color
			userMessageText: '#000000',
			// Diff highlight opacity
			diffOpacity: 1,
		},
	},
	'macaron-pink': {
		name: 'Macaron Pink',
		type: 'macaron-pink',
		colors: {
			background: '#fff0f5',
			text: '#5a2a4a',
			border: '#f7b6d2',
			diffAdded: '#d9f5e8',
			diffRemoved: '#ffe0ea',
			diffModified: '#e8a87c',
			diffAddedForeground: '#4f9b78',
			diffRemovedForeground: '#e5547d',
			lineNumber: '#b07a96',
			lineNumberBorder: '#f3c6dc',
			// Menu colors - macaron pastel palette
			menuSelected: '#ff7eb6',
			menuNormal: '#5a2a4a',
			menuInfo: '#b388eb',
			menuSecondary: '#a87a96',
			// Status colors
			error: '#e5547d',
			warning: '#e8a87c',
			success: '#7ec4a3',
			cyan: '#8fd3d8',
			// Logo gradient - pink to lavender macaron
			logoGradient: ['#ffb3d1', '#ff7eb6', '#b388eb'],
			// User message background - soft pink macaron
			userMessageBackground: '#ffd1e3',
			// User message text color
			userMessageText: '#5a2a4a',
			// Diff highlight opacity
			diffOpacity: 1,
		},
	},
	'trump-gold': {
		name: 'Trump Gold',
		type: 'trump-gold',
		colors: {
			background: '#120d08',
			text: '#f7e6a3',
			border: '#d4af37',
			diffAdded: '#173d22',
			diffRemoved: '#5a2217',
			diffModified: '#ffd700',
			diffAddedForeground: '#7bd88f',
			diffRemovedForeground: '#ff6b4a',
			lineNumber: '#b88a2a',
			lineNumberBorder: '#6f4e16',
			// Menu colors - bold presidential gold palette
			menuSelected: '#ffd700',
			menuNormal: '#f7e6a3',
			menuInfo: '#f4b942',
			menuSecondary: '#b88a2a',
			// Status colors
			error: '#ff6b4a',
			warning: '#ffd700',
			success: '#7bd88f',
			cyan: '#f4b942',
			// Logo gradient - rich gold tones
			logoGradient: ['#fff2a8', '#ffd700', '#b8860b'],
			// User message background - deep antique gold
			userMessageBackground: '#5a3d0c',
			// User message text color
			userMessageText: '#fff7cc',
			// Diff highlight opacity
			diffOpacity: 1,
		},
	},
	'china-red': {
		name: 'China Red',
		type: 'china-red',
		colors: {
			background: '#1a0a0a',
			text: '#f7d4d4',
			border: '#cc2936',
			diffAdded: '#17391f',
			diffRemoved: '#5a1111',
			diffModified: '#ffd166',
			diffAddedForeground: '#6fcf6f',
			diffRemovedForeground: '#ff4d4d',
			lineNumber: '#d47a7a',
			lineNumberBorder: '#8b2222',
			// Menu colors - bold Chinese red palette
			menuSelected: '#e60012',
			menuNormal: '#f7d4d4',
			menuInfo: '#e8585e',
			menuSecondary: '#b54343',
			// Status colors
			error: '#ff4d4d',
			warning: '#ffd166',
			success: '#6fcf6f',
			cyan: '#e8585e',
			// Logo gradient - red to gold
			logoGradient: ['#e60012', '#d43038', '#ffd166'],
			// User message background - deep red
			userMessageBackground: '#3d0d0d',
			// User message text color
			userMessageText: '#fff0e0',
			// Diff highlight opacity
			diffOpacity: 1,
		},
	},
	'eva-purple': {
		name: 'Optimus Prime',
		type: 'eva-purple',
		colors: {
			background: '#151a2e',
			text: '#e2e4f0',
			border: '#c42828',
			diffAdded: '#193450',
			diffRemoved: '#4a161d',
			diffModified: '#b0b8d0',
			diffAddedForeground: '#5b9bd5',
			diffRemovedForeground: '#e63946',
			lineNumber: '#8a98b0',
			lineNumberBorder: '#2a355e',
			// Menu colors - Optimus Prime red/blue/silver
			menuSelected: '#e63946',
			menuNormal: '#e2e4f0',
			menuInfo: '#5b9bd5',
			menuSecondary: '#7a88a0',
			// Status colors
			error: '#e63946',
			warning: '#f5c542',
			success: '#5b9bd5',
			cyan: '#5b9bd5',
			// Logo gradient - red to silver to blue
			logoGradient: ['#e63946', '#b0b8d0', '#5b9bd5'],
			// User message background - dark red
			userMessageBackground: '#3d1c1c',
			// User message text color
			userMessageText: '#fff0e0',
			// Diff highlight opacity
			diffOpacity: 1,
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
