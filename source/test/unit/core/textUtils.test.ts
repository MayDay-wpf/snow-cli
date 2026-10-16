import test from 'ava';
import {
	toCodePoints,
	cpLen,
	cpSlice,
	visualWidth,
	getCharAtVisualPos,
} from '../../../utils/core/textUtils.js';

// ============================================================================
// Core Domain (L0 Unit): textUtils 字符与视口列宽不变量测试
// 依据 testing-scenario-tui 与 testing-core-oracle 契约判定
// ============================================================================

test('textUtils: toCodePoints and cpLen handle ASCII and surrogate pairs correctly', t => {
	t.is(cpLen('hello'), 5);
	t.deepEqual(toCodePoints('hello'), ['h', 'e', 'l', 'l', 'o']);

	// 包含 Emoji 与变音符 (Surrogate Pair)
	const emojiStr = '🚀star';
	t.is(cpLen(emojiStr), 5); // 1 emoji + 4 chars
	t.is(emojiStr.length, 6); // UTF-16 length is 6, but code point length is 5
	t.is(toCodePoints(emojiStr)[0], '🚀');
});

test('textUtils: cpSlice slices by Unicode code point boundaries without corrupting surrogates', t => {
	const str = '雪花❄️AI🚀终端';
	t.is(cpSlice(str, 0, 2), '雪花');
	t.is(cpSlice(str, 4, 6), 'AI');
	// 切割包含复合 Emoji
	const rocketStr = 'A🚀B';
	t.is(cpSlice(rocketStr, 1, 2), '🚀');
	t.is(cpSlice(rocketStr, 1, 3), '🚀B');
});

test('textUtils: visualWidth computes terminal column occupation correctly', t => {
	// 半角 ASCII = 1 列
	t.is(visualWidth('abc'), 3);

	// 全角中文字符 = 2 列
	t.is(visualWidth('你好'), 4);
	t.is(visualWidth('Snow雪'), 6); // 4 + 2

	// Emoji 视口占用 = 2 列
	t.is(visualWidth('🚀'), 2);
	t.is(visualWidth('✨'), 2);
});

test('textUtils: getCharAtVisualPos precisely maps terminal cursor position to code point', t => {
	const str = '中a文';
	// '中' 占用第 0, 1 列
	const pos0 = getCharAtVisualPos(str, 0);
	t.is(pos0?.char, '中');
	t.is(pos0?.codePointIndex, 0);

	const pos1 = getCharAtVisualPos(str, 1);
	t.is(pos1?.char, '中'); // 处于全角字符中间
	t.is(pos1?.codePointIndex, 0);

	// 'a' 占用第 2 列
	const pos2 = getCharAtVisualPos(str, 2);
	t.is(pos2?.char, 'a');
	t.is(pos2?.codePointIndex, 1);

	// '文' 占用第 3, 4 列
	const pos3 = getCharAtVisualPos(str, 3);
	t.is(pos3?.char, '文');
	t.is(pos3?.codePointIndex, 2);

	// 末尾边界
	const posEnd = getCharAtVisualPos(str, 5);
	t.is(posEnd?.char, '');
	t.is(posEnd?.codePointIndex, 3);
});
