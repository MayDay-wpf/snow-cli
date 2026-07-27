import anyTest, {type TestFn} from 'ava';
import {
	getCurrentLanguage,
	setCurrentLanguage,
	type Language,
} from '../utils/config/languageConfig.js';
import {getPlanModeSystemPrompt} from '../prompt/planModeSystemPrompt.js';
import {isPlanApprovalAnswer} from '../utils/execution/planModeGate.js';

const test = anyTest as unknown as TestFn;

function withLanguage(language: Language, run: () => void): void {
	const previous = getCurrentLanguage();
	setCurrentLanguage(language);
	try {
		run();
	} finally {
		setCurrentLanguage(previous);
	}
}

test('plan mode prompt uses Chinese approval options for zh UI', t => {
	withLanguage('zh', () => {
		const prompt = getPlanModeSystemPrompt(true);
		t.true(prompt.includes('确认示例（中文界面 — 选项必须中文）'));
		t.true(
			prompt.includes('["是 - 执行整个计划", "先让我查看计划", "修改计划"]'),
		);
		t.true(prompt.includes('选项必须全部使用中文'));
		// English option array should not be the active example for zh UI.
		t.false(
			prompt.includes(
				'["Yes - Execute the entire plan", "Let me review the plan first", "Modify the plan"]',
			),
		);
	});
});

test('plan mode prompt keeps English approval options for en UI', t => {
	withLanguage('en', () => {
		const prompt = getPlanModeSystemPrompt(true);
		t.true(
			prompt.includes(
				'["Yes - Execute the entire plan", "Let me review the plan first", "Modify the plan"]',
			),
		);
		t.true(prompt.includes('Option language rule'));
		// Chinese option array should not be the active example for en UI.
		t.false(
			prompt.includes('["是 - 执行整个计划", "先让我查看计划", "修改计划"]'),
		);
		// Unapproved phase must not require terminal-execute IDE open.
		t.true(
			prompt.includes(
				'Do NOT use `terminal-execute` to open the plan in an IDE while the plan is unapproved',
			),
		);
		t.false(prompt.includes('code -g <absolute-path>'));
	});
});

test('Chinese plan approval option unlocks the gate', t => {
	t.true(
		isPlanApprovalAnswer({
			question: '实现计划已就绪，是否开始执行整个计划？',
			selected: '是 - 执行整个计划',
		}),
	);
});
