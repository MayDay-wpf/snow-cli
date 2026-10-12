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
