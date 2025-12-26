import React, {
	createContext,
	useContext,
	useState,
	useCallback,
	ReactNode,
} from 'react';
import {ThemeType, themes, Theme, getCustomTheme} from '../themes/index.js';
import {
	getCurrentTheme,
	setCurrentTheme,
} from '../../utils/config/themeConfig.js';

interface ThemeContextType {
	theme: Theme;
	themeType: ThemeType;
	setThemeType: (type: ThemeType) => void;
	refreshCustomTheme?: () => void;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(
	undefined,
);

interface ThemeProviderProps {
	children: ReactNode;
}

export function ThemeProvider({children}: ThemeProviderProps) {
	const [themeType, setThemeTypeState] = useState<ThemeType>(() => {
		// Load initial theme from config
		return getCurrentTheme();
	});
	const [customThemeVersion, setCustomThemeVersion] = useState(0);

	const setThemeType = (type: ThemeType) => {
		setThemeTypeState(type);
		// Persist to config file
		setCurrentTheme(type);
	};

	const refreshCustomTheme = useCallback(() => {
		setCustomThemeVersion(v => v + 1);
	}, []);

	const getTheme = useCallback((): Theme => {
		if (themeType === 'custom') {
			// Force re-read custom theme when version changes
			void customThemeVersion;
			return getCustomTheme();
		}
		return themes[themeType];
	}, [themeType, customThemeVersion]);

	const value: ThemeContextType = {
		theme: getTheme(),
		themeType,
		setThemeType,
		refreshCustomTheme,
	};

	return (
		<ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
	);
}

export function useTheme(): ThemeContextType {
	const context = useContext(ThemeContext);
	if (!context) {
		throw new Error('useTheme must be used within a ThemeProvider');
	}
	return context;
}
