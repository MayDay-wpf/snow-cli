import React, {
	createContext,
	useContext,
	useState,
	useCallback,
	useEffect,
	ReactNode,
} from 'react';
import {existsSync, readFileSync, watch as watchFile, type FSWatcher} from 'fs';
import {homedir} from 'os';
import {join} from 'path';
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

const THEME_CONFIG_PATH = join(homedir(), '.snow', 'theme.json');

/** Watch the theme config across atomic replacement and delayed recreation. */
export function watchThemeConfigFile(onChange: () => void): () => void {
	let watcher: FSWatcher | null = null;
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let watchRetryTimer: ReturnType<typeof setTimeout> | null = null;
	let disposed = false;
	let shouldReloadAfterAttach = false;

	const scheduleReload = () => {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			if (!disposed) onChange();
		}, 80);
	};

	const scheduleWatchRetry = (delayMs: number) => {
		if (disposed || watcher || watchRetryTimer) return;
		watchRetryTimer = setTimeout(() => {
			watchRetryTimer = null;
			startWatch();
		}, delayMs);
		watchRetryTimer.unref?.();
	};

	const startWatch = () => {
		if (disposed || watcher) return;
		if (!existsSync(THEME_CONFIG_PATH)) {
			shouldReloadAfterAttach = true;
			scheduleWatchRetry(400);
			return;
		}
		try {
			watcher = watchFile(THEME_CONFIG_PATH, {persistent: false}, eventType => {
				scheduleReload();
				if (eventType === 'rename') {
					try {
						watcher?.close();
					} catch {
						// ignore
					}
					watcher = null;
					shouldReloadAfterAttach = true;
					scheduleWatchRetry(150);
				}
			});
			watcher.on('error', () => {
				try {
					watcher?.close();
				} catch {
					// ignore
				}
				watcher = null;
				shouldReloadAfterAttach = true;
				scheduleWatchRetry(200);
			});
			if (shouldReloadAfterAttach) {
				shouldReloadAfterAttach = false;
				scheduleReload();
			}
		} catch {
			shouldReloadAfterAttach = true;
			scheduleWatchRetry(300);
		}
	};

	startWatch();

	return () => {
		disposed = true;
		if (watchRetryTimer) clearTimeout(watchRetryTimer);
		if (debounceTimer) clearTimeout(debounceTimer);
		try {
			watcher?.close();
		} catch {
			// ignore
		}
	};
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
				// Switching to custom should re-read colors from disk
				// (agent may have written customColors right before theme.set).
				if (event.value === 'custom') {
					setCustomThemeVersion(v => v + 1);
				}
			} else if (event.type === 'customColors') {
				// Colors changed via saveCustomColors / session-command — hot reload.
				setCustomThemeVersion(v => v + 1);
			} else if (event.type === 'diffOpacity') {
				setDiffOpacityState(Number(event.value));
			}
		};

		configEvents.onConfigChange(handleConfigChange);
		return () => {
			configEvents.removeConfigChangeListener(handleConfigChange);
		};
	}, []);

	// External writes to ~/.snow/theme.json (agent force-write / manual edit)
	// must hot-refresh without restarting the process.
	useEffect(() => {
		const applyFromDisk = () => {
			try {
				// Validate the file before calling helpers that intentionally fall back
				// to defaults on parse errors. Transient half-writes must keep the
				// current UI theme instead of flashing back to defaults.
				JSON.parse(readFileSync(THEME_CONFIG_PATH, 'utf8'));
				const nextTheme = getCurrentTheme();
				const nextOpacity = getDiffOpacity();
				setThemeTypeState(nextTheme);
				setDiffOpacityState(nextOpacity);
				// Always bump custom theme version so custom palette reloads
				// even when theme type stays "custom".
				setCustomThemeVersion(v => v + 1);
			} catch {
				// ignore corrupt transient writes
			}
		};

		return watchThemeConfigFile(applyFromDisk);
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
