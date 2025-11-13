import type {Translations} from './types.js';
import {en} from './lang/en.js';
import {zh} from './lang/zh.js';
import {zhTW} from './lang/zh-TW.js';
import {ja} from './lang/ja.js';
import {ko} from './lang/ko.js';
import {es} from './lang/es.js';

export const translations: Translations = {
	en,
	zh,
	'zh-TW': zhTW,
	ja,
	ko,
	es,
};
