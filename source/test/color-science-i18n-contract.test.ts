import test from 'ava';
import {zh} from '../i18n/lang/zh.js';
import {zhTW} from '../i18n/lang/zh-TW.js';
import {en} from '../i18n/lang/en.js';

test('L5 i18n Contract: customTheme keys are 100% symmetric across zh, zh-TW and en', t => {
	const zhKeys = Object.keys(zh.customTheme).sort();
	const zhTWKeys = Object.keys(zhTW.customTheme).sort();
	const enKeys = Object.keys(en.customTheme).sort();

	// 1. 简中与英文键名对称
	t.deepEqual(zhKeys, enKeys, 'zh and en customTheme keys must be identical');

	// 2. 简中与繁中键名对称
	t.deepEqual(zhKeys, zhTWKeys, 'zh and zh-TW customTheme keys must be identical');

	// 3. 核心 6 维字段键名必须存在且非空
	const requiredFields = [
		'studioMode',
		'expertMode',
		'fieldHue',
		'fieldChroma',
		'fieldMood',
		'fieldLuminanceBias',
		'fieldDiffHarmony',
		'fieldDiffIntensity',
		'diffHarmonyAdaptive',
		'diffHarmonyClassic',
		'diffHarmonyAccessible',
		'apcaRatingPass',
		'apcaRatingWeak',
		'sampleCodeFilename',
		'sampleOldCode',
		'sampleNewCode',
	];

	for (const f of requiredFields) {
		t.true(f in zh.customTheme, `Missing key in zh: ${f}`);
		t.true(f in zhTW.customTheme, `Missing key in zh-TW: ${f}`);
		t.true(f in en.customTheme, `Missing key in en: ${f}`);

		t.truthy((zh.customTheme as Record<string, string>)[f], `Empty translation in zh: ${f}`);
		t.truthy((zhTW.customTheme as Record<string, string>)[f], `Empty translation in zh-TW: ${f}`);
		t.truthy((en.customTheme as Record<string, string>)[f], `Empty translation in en: ${f}`);
	}
});
