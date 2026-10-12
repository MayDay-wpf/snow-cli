import anyTest, {type TestFn} from 'ava';

import {TextBuffer} from '../utils/ui/textBuffer.js';
import {restoreTextWithSkillPlaceholders} from '../utils/ui/restoreTextWithMarkers.js';

const test = anyTest as unknown as TestFn;

const viewport = {width: 120, height: 30};

function pasteLines(count: number): string {
	return Array.from({length: count}, (_, i) => `pasted line ${i}`).join('\n');
}

function roundTripViaMarkers(buffer: TextBuffer): TextBuffer {
	const draft = buffer.getFullTextWithPasteMarkers();
	const restored = new TextBuffer(viewport);
	restoreTextWithSkillPlaceholders(restored, draft);
	return restored;
}

test('typed text and paste placeholder both survive a marker draft round-trip', t => {
	const buffer = new TextBuffer(viewport);
	buffer.insertRestoredText('check this code\n');
	buffer.insertTextPlaceholder(pasteLines(30), '[Paste 30 lines #1] ');

	const restored = roundTripViaMarkers(buffer);

	t.true(restored.text.includes('check this code'));
	t.true(restored.text.includes('[Paste 30 lines #1]'));
	t.is(restored.getFullText(), buffer.getFullText());
});

test('plain getFullText draft merges typed text and paste into a single placeholder', t => {
	const buffer = new TextBuffer(viewport);
	buffer.insertRestoredText('check this code\n');
	buffer.insertTextPlaceholder(pasteLines(30), '[Paste 30 lines #1] ');

	const restored = new TextBuffer(viewport);
	restoreTextWithSkillPlaceholders(restored, buffer.getFullText());

	t.false(restored.text.includes('check this code'));
	t.true(restored.text.startsWith('[Paste '));
	t.is(restored.getFullText(), buffer.getFullText());
});

test('multiple paste placeholders round-trip with interleaved text', t => {
	const buffer = new TextBuffer(viewport);
	buffer.insertRestoredText('a ');
	buffer.insertTextPlaceholder(pasteLines(30), '[Paste 30 lines #1] ');
	buffer.insertRestoredText('b ');
	buffer.insertTextPlaceholder(
		`${pasteLines(30)}\nextra`,
		'[Paste 31 lines #2] ',
	);

	const restored = roundTripViaMarkers(buffer);

	t.is(restored.text, 'a \n[Paste 30 lines #1] b \n[Paste 31 lines #2] ');
	t.is(
		restored.getFullText(),
		`a \n${pasteLines(30)}b \n${pasteLines(30)}\nextra`,
	);
});

test('inline paste gains a newline before the placeholder on restore', t => {
	const buffer = new TextBuffer(viewport);
	buffer.insertRestoredText('fix this');
	buffer.insertTextPlaceholder(pasteLines(30), '[Paste 30 lines #1] ');

	const restored = roundTripViaMarkers(buffer);

	t.is(restored.text, 'fix this\n[Paste 30 lines #1] ');
});

test('short typed-only draft restores verbatim', t => {
	const buffer = new TextBuffer(viewport);
	restoreTextWithSkillPlaceholders(buffer, 'just some typed text');
	t.is(buffer.text, 'just some typed text');
});

test('typed-only draft of 400+ characters collapses into a placeholder', t => {
	const buffer = new TextBuffer(viewport);
	restoreTextWithSkillPlaceholders(buffer, 'typed '.repeat(100));
	t.true(buffer.text.startsWith('[Paste '));
	t.is(buffer.getFullText(), 'typed '.repeat(100));
});

test('maskPlainChunks:false keeps 400+ char typed draft as visible text', t => {
	const buffer = new TextBuffer(viewport);
	restoreTextWithSkillPlaceholders(buffer, 'typed '.repeat(100), {
		maskPlainChunks: false,
	});

	t.false(buffer.text.startsWith('[Paste '));
	t.true(buffer.text.includes('typed '));
	t.is(buffer.getFullText(), 'typed '.repeat(100));
});

test('maskPlainChunks:false keeps 12+ line typed draft as visible text', t => {
	const buffer = new TextBuffer(viewport);
	const text = Array.from({length: 15}, (_, i) => `line ${i}`).join('\n');
	restoreTextWithSkillPlaceholders(buffer, text, {maskPlainChunks: false});

	t.false(buffer.text.includes('[Paste '));
	t.is(buffer.getFullText(), text);
});

test('maskPlainChunks:false restores typed text plainly while paste markers still become pills', t => {
	const typed = 'check this\n'.repeat(50);
	const buffer = new TextBuffer(viewport);
	restoreTextWithSkillPlaceholders(
		buffer,
		`${typed}# Paste:\n${pasteLines(30)}\n# Paste End\ntail`,
		{maskPlainChunks: false},
	);

	t.true(buffer.text.includes('check this'));
	t.true(buffer.text.includes('[Paste 30 lines #1]'));
	t.false(buffer.text.startsWith('[Paste '));
	t.is(buffer.getFullText(), `${typed}${pasteLines(30)}tail`);
});

test('maskPlainChunks:true behaves identically to the default', t => {
	const explicit = new TextBuffer(viewport);
	const defaulted = new TextBuffer(viewport);
	const text = 'typed '.repeat(100);
	restoreTextWithSkillPlaceholders(explicit, text, {maskPlainChunks: true});
	restoreTextWithSkillPlaceholders(defaulted, text);

	t.is(explicit.text, defaulted.text);
	t.true(explicit.text.startsWith('[Paste '));
});

test('maskPlainChunks:false at 399/400-char boundary keeps both plain', t => {
	const small = new TextBuffer(viewport);
	const large = new TextBuffer(viewport);
	restoreTextWithSkillPlaceholders(small, 'x'.repeat(399), {
		maskPlainChunks: false,
	});
	restoreTextWithSkillPlaceholders(large, 'x'.repeat(400), {
		maskPlainChunks: false,
	});

	t.is(small.text, 'x'.repeat(399));
	t.is(large.text, 'x'.repeat(400));
});

test('fold boundary at exactly 400 chars under default options', t => {
	const below = new TextBuffer(viewport);
	const at = new TextBuffer(viewport);
	restoreTextWithSkillPlaceholders(below, 'x'.repeat(399));
	restoreTextWithSkillPlaceholders(at, 'x'.repeat(400));

	t.is(below.text, 'x'.repeat(399));
	t.true(at.text.startsWith('[Paste '));
});

test('fold boundary at 11 vs 12 lines under default options', t => {
	const below = new TextBuffer(viewport);
	const at = new TextBuffer(viewport);
	restoreTextWithSkillPlaceholders(
		below,
		Array.from({length: 11}, (_, i) => `l${i}`).join('\n'),
	);
	restoreTextWithSkillPlaceholders(
		at,
		Array.from({length: 12}, (_, i) => `l${i}`).join('\n'),
	);

	t.false(below.text.includes('[Paste '));
	t.true(at.text.startsWith('[Paste '));
});

test('empty options object behaves identically to no options', t => {
	const empty = new TextBuffer(viewport);
	const none = new TextBuffer(viewport);
	restoreTextWithSkillPlaceholders(empty, 'x'.repeat(500), {});
	restoreTextWithSkillPlaceholders(none, 'x'.repeat(500));

	t.is(empty.text, none.text);
	t.true(empty.text.startsWith('[Paste '));
});

test('maskPlainChunks:false does not disable paste marker parsing', t => {
	const buffer = new TextBuffer(viewport);
	restoreTextWithSkillPlaceholders(
		buffer,
		`text\n# Paste:\n${pasteLines(30)}\n# Paste End`,
		{maskPlainChunks: false},
	);

	t.true(buffer.text.includes('[Paste 30 lines #1]'));
	t.true(buffer.text.includes('text'));
});

test('maskPlainChunks:false keeps skill blocks as placeholders', t => {
	const buffer = new TextBuffer(viewport);
	restoreTextWithSkillPlaceholders(
		buffer,
		`${'a'.repeat(450)}\n# Skill: my-skill\nbody\n# Skill End`,
		{maskPlainChunks: false},
	);

	t.false(buffer.text.startsWith('[Paste '));
	t.true(buffer.text.includes('[Skill:my-skill]'));
});

test('double round-trip of unmasked typed draft is stable', t => {
	const first = new TextBuffer(viewport);
	restoreTextWithSkillPlaceholders(first, 'typed '.repeat(100), {
		maskPlainChunks: false,
	});
	const second = new TextBuffer(viewport);
	restoreTextWithSkillPlaceholders(
		second,
		first.getFullTextWithPasteMarkers(),
		{maskPlainChunks: false},
	);

	t.is(second.text, first.text);
	t.is(second.getFullText(), 'typed '.repeat(100));
});

test('maskPlainChunks:false with 20000-char draft stays plain', t => {
	const buffer = new TextBuffer(viewport);
	const huge = 'x'.repeat(20_000);
	restoreTextWithSkillPlaceholders(buffer, huge, {maskPlainChunks: false});

	t.is(buffer.text, huge);
	t.false(buffer.text.includes('[Paste '));
	t.is(buffer.getFullText(), huge);
});

test('maskPlainChunks:false with 500-line draft stays plain', t => {
	const buffer = new TextBuffer(viewport);
	const huge = Array.from({length: 500}, (_, i) => `line ${i}`).join('\n');
	restoreTextWithSkillPlaceholders(buffer, huge, {maskPlainChunks: false});

	t.is(buffer.text, huge);
	t.false(buffer.text.includes('[Paste '));
});

test('small paste placeholder below fold thresholds restores via marker block', t => {
	const buffer = new TextBuffer(viewport);
	buffer.insertRestoredText('x ');
	buffer.insertTextPlaceholder('a\nb\nc', '[Paste 3 lines #1] ');

	const restored = roundTripViaMarkers(buffer);

	t.is(restored.text, 'x \n[Paste 3 lines #1] ');
	t.is(restored.getFullText(), 'x \na\nb\nc');
});

test('skill marker block restores into a skill placeholder', t => {
	const buffer = new TextBuffer(viewport);
	restoreTextWithSkillPlaceholders(
		buffer,
		'# Skill: my-skill\nbody line\n# Skill End\ntail',
	);
	t.is(buffer.text, '[Skill:my-skill] tail');
});

test('unterminated skill marker block still becomes a placeholder', t => {
	const buffer = new TextBuffer(viewport);
	restoreTextWithSkillPlaceholders(buffer, '# Skill: my-skill\nnever closed');
	t.is(buffer.text, '[Skill:my-skill] ');
	t.is(buffer.getFullText(), '# Skill: my-skill\nnever closed');
});

test('cjk and emoji paste content round-trips', t => {
	const buffer = new TextBuffer(viewport);
	buffer.insertRestoredText('看下这个\n');
	buffer.insertTextPlaceholder(
		pasteLines(30) + '\n你好世界 🚀',
		'[Paste 31 lines #1] ',
	);

	const restored = roundTripViaMarkers(buffer);

	t.true(restored.text.includes('看下这个'));
	t.is(restored.getFullText(), buffer.getFullText());
});

test('crlf in paste content is normalized during restore', t => {
	const buffer = new TextBuffer(viewport);
	buffer.insertRestoredText('x ');
	buffer.insertTextPlaceholder(
		'a\r\nb\r\nc\r\n' + 'd'.repeat(400),
		'[Paste 4 lines #1] ',
	);

	const restored = roundTripViaMarkers(buffer);

	t.false(restored.getFullText().includes('\r'));
});

test('image placeholder stays literal through marker serialization', t => {
	const buffer = new TextBuffer(viewport);
	buffer.insertRestoredText('x ');
	buffer.insertImage('aGVsbG8=', 'image/png');
	buffer.insertTextPlaceholder(pasteLines(30), '[Paste 30 lines #1] ');

	const draft = buffer.getFullTextWithPasteMarkers();
	t.true(draft.includes('[image #1]'));
	t.true(draft.includes('# Paste:'));
});

test('empty text is a no-op', t => {
	const buffer = new TextBuffer(viewport);
	restoreTextWithSkillPlaceholders(buffer, '');
	t.is(buffer.text, '');
});

test('paste end marker inside content truncates the block early', t => {
	const buffer = new TextBuffer(viewport);
	buffer.insertRestoredText('t ');
	buffer.insertTextPlaceholder(
		`# Paste End\n${pasteLines(30)}`,
		'[Paste 31 lines #1] ',
	);

	const restored = roundTripViaMarkers(buffer);

	t.is(restored.text, 't \n[Paste 32 lines #1] ');
	t.not(restored.getFullText(), buffer.getFullText());
});
