import React, {
	createContext,
	useState,
	useCallback,
	useEffect,
	ReactNode,
} from 'react';
import type {Language, TranslationKeys} from './types.js';
import {translations} from './translations.js';
import {
	getCurrentLanguage,
	setCurrentLanguage,
} from '../utils/config/languageConfig.js';
import {configEvents} from '../utils/config/configEvents.js';

type I18nContextType = {
	language: Language;
	setLanguage: (lang: Language) => void;
	t: TranslationKeys;
};

const I18nContext = createContext<I18nContextType | undefined>(undefined);

type Props = {
	children: ReactNode;
	defaultLanguage?: Language;
};

export function I18nProvider({children, defaultLanguage}: Props) {
	// Load saved language on mount or use default
	const [language, setLanguageState] = useState<Language>(() => {
		return defaultLanguage || getCurrentLanguage();
	});

	const setLanguage = useCallback((lang: Language) => {
		setLanguageState(lang);
		setCurrentLanguage(lang); // Persist to file system
	}, []);

	// Same-process session-command / agentic language writes update React state only.
	useEffect(() => {
		const handleConfigChange = (event: {type: string; value: any}) => {
			if (event.type === 'language') {
				const next = event.value as Language;
				setLanguageState(prev => (prev === next ? prev : next));
			}
		};
		configEvents.onConfigChange(handleConfigChange);
		return () => {
			configEvents.removeConfigChangeListener(handleConfigChange);
		};
	}, []);

	// Get translations for current language
	const t = translations[language];

	return (
		<I18nContext.Provider value={{language, setLanguage, t}}>
			{children}
		</I18nContext.Provider>
	);
}

export function useI18n(): I18nContextType {
	const context = React.useContext(I18nContext);
	if (!context) {
		throw new Error('useI18n must be used within I18nProvider');
	}
	return context;
}
