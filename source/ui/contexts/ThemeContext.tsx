import React, {
	createContext,
	useContext,
	useState,
	useCallback,
	useEffect,
	ReactNode,
} from 'react';
import {ThemeType, themes, Theme, getCustomTheme} from '../themes/index.js';
import {
	getCurrentTheme,
	getDiffOpacity,
	setCurrentTheme,
	setDiffOpacity,
} from '../../utils/config/themeConfig.js';
import {configEvents} from '../../utils/config/configEvents.js';

interface ThemeContextType {
	theme: Theme;
	themeType: ThemeType;
	diffOpacity: number;
	setThemeType: (type: ThemeType) => void;
	setDiffOpacity: (opacity: number) => void;
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
	const [diffOpacity, setDiffOpacityState] = useState<number>(() =>
		getDiffOpacity(),
	);
	const [customThemeVersion, setCustomThemeVersion] = useState(0);

	const setThemeType = (type: ThemeType) => {
		setThemeTypeState(type);
		// Persist to config file
		setCurrentTheme(type);
	};

	const handleSetDiffOpacity = (opacity: number) => {
		setDiffOpacityState(opacity);
		setDiffOpacity(opacity);
	};

	const refreshCustomTheme = useCallback(() => {
		setCustomThemeVersion(v => v + 1);
	}, []);

	// Same-process session-command / agentic writes update React state only.
	// Do not re-call setters that persist to disk (would loop / thrash).
	useEffect(() => {
		const handleConfigChange = (event: {type: string; value: any}) => {
			if (event.type === 'theme') {
				setThemeTypeState(event.value as ThemeType);
			} else if (event.type === 'diffOpacity') {
				setDiffOpacityState(Number(event.value));
			}
		};

		configEvents.onConfigChange(handleConfigChange);
		return () => {
			configEvents.removeConfigChangeListener(handleConfigChange);
		};
	}, []);

	const getTheme = useCallback((): Theme => {
		if (themeType === 'custom') {
			// Force re-read custom theme when version changes
			void customThemeVersion;
			return getCustomTheme();
		}
		return themes[themeType];
	}, [themeType, customThemeVersion]);

	const baseTheme = getTheme();
	const value: ThemeContextType = {
		theme: {
			...baseTheme,
			colors: {
				...baseTheme.colors,
				diffOpacity,
			},
		},
		themeType,
		diffOpacity,
		setThemeType,
		setDiffOpacity: handleSetDiffOpacity,
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
