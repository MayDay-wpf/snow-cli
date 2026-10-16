import test from 'ava';
import {translations} from '../../../i18n/translations.js';
import type {Language} from '../../../i18n/types.js';

test('i18n defines identical top-level keys across all supported locales', t => {
	const supportedLanguages: Language[] = ['en', 'zh', 'zh-TW'];

	for (const lang of supportedLanguages) {
		t.truthy(translations[lang], `Locale ${lang} must exist`);
	}

	const enKeys = Object.keys(translations.en).sort();
	const zhKeys = Object.keys(translations.zh).sort();
	const zhTWKeys = Object.keys(translations['zh-TW']).sort();

	t.deepEqual(zhKeys, enKeys, 'zh keys must match en keys');
	t.deepEqual(zhTWKeys, enKeys, 'zh-TW keys must match en keys');
});

test('i18n critical sections (welcome, notification, codebaseConfig) contain non-empty strings', t => {
	const checkObjectLeaves = (obj: any, path = '') => {
		for (const [key, value] of Object.entries(obj)) {
			const currentPath = path ? `${path}.${key}` : key;
			if (typeof value === 'object' && value !== null) {
				checkObjectLeaves(value, currentPath);
			} else {
				t.is(
					typeof value,
					'string',
					`Translation key ${currentPath} must be a string`,
				);
				t.true(
					(value as string).trim().length > 0,
					`Translation key ${currentPath} must not be empty`,
				);
			}
		}
	};

	checkObjectLeaves(translations.en.welcome, 'en.welcome');
	checkObjectLeaves(translations.zh.welcome, 'zh.welcome');
	checkObjectLeaves(translations['zh-TW'].welcome, 'zh-TW.welcome');

	checkObjectLeaves(translations.en.notification, 'en.notification');
	checkObjectLeaves(translations.zh.notification, 'zh.notification');
	checkObjectLeaves(translations['zh-TW'].notification, 'zh-TW.notification');
});
