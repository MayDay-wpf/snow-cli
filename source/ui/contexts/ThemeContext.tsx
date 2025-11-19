import React, {
	createContext,
	useContext,
	useState,
	ReactNode,
} from 'react';
import {ThemeType, themes, Theme} from '../themes/index.js';
import {
	getCurrentTheme,
	setCurrentTheme,
} from '../../utils/themeConfig.js';

interface ThemeContextType {
	theme: Theme;
	themeType: ThemeType;
	setThemeType: (type: ThemeType) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
	children: ReactNode;
}

export function ThemeProvider({children}: ThemeProviderProps) {
	const [themeType, setThemeTypeState] = useState<ThemeType>(() => {
		// Load initial theme from config
		return getCurrentTheme();
	});

	const setThemeType = (type: ThemeType) => {
		setThemeTypeState(type);
		// Persist to config file
		setCurrentTheme(type);
	};

	const value: ThemeContextType = {
		theme: themes[themeType],
		themeType,
		setThemeType,
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
