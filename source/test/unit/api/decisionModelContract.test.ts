import test from 'ava';
import {
	resolveDecisionModelReviewConfig,
	resolveSystemOneEndpoint,
	SENSITIVE_COMMAND_REASON_CATEGORIES,
} from '../../../api/decisionModel.js';
import type {DecisionModelItem} from '../../../utils/config/decisionModelsConfig.js';
import {parseCanonicalPath} from '../../../utils/core/canonicalPath.js';

test('resolveDecisionModelReviewConfig: returns undefined for undefined or missing keys', t => {
	t.is(resolveDecisionModelReviewConfig(undefined), undefined);

	const missingApiKey: DecisionModelItem = {
		id: 'm1',
		name: 'Model 1',
		baseUrl: 'https://api.typesafe.ai/v1',
		baseUrlMode: 'auto',
		apiKey: '   ',
		model: 'system-one-preview',
	};
	t.is(resolveDecisionModelReviewConfig(missingApiKey), undefined);

	const missingModel: DecisionModelItem = {
		id: 'm2',
		name: 'Model 2',
		baseUrl: 'https://api.typesafe.ai/v1',
		baseUrlMode: 'auto',
		apiKey: 'sec-12345',
		model: '   ',
	};
	t.is(resolveDecisionModelReviewConfig(missingModel), undefined);
});

test('resolveDecisionModelReviewConfig: extracts clean config when valid', t => {
	const validItem: DecisionModelItem = {
		id: 'm-valid',
		name: 'Production Decision Model',
		baseUrl: 'https://custom-gateway.internal/v1',
		baseUrlMode: 'endpoint',
		apiKey: '  token-secret-xyz  ',
		model: '  system-one-2026  ',
	};

	const resolved = resolveDecisionModelReviewConfig(validItem);
	t.truthy(resolved);
	t.is(resolved?.baseUrl, 'https://custom-gateway.internal/v1');
	t.is(resolved?.baseUrlMode, 'endpoint');
	t.is(resolved?.apiKey, 'token-secret-xyz');
	t.is(resolved?.model, 'system-one-2026');
});

test('resolveSystemOneEndpoint: obeys auto and endpoint modes with path normalization', t => {
	// Empty baseUrl defaults to standard endpoint
	t.is(resolveSystemOneEndpoint(''), 'https://api.typesafe.ai/v1/systemone');
	t.is(resolveSystemOneEndpoint('   '), 'https://api.typesafe.ai/v1/systemone');

	// endpoint mode preserves full custom url
	t.is(
		resolveSystemOneEndpoint('https://proxy.example.com/custom/eval', 'endpoint'),
		'https://proxy.example.com/custom/eval',
	);

	// auto mode appends /systemone if ending with /v1
	t.is(
		resolveSystemOneEndpoint('https://my-llm.com/v1', 'auto'),
		'https://my-llm.com/v1/systemone',
	);

	// auto mode preserves if already ending with /systemone
	t.is(
		resolveSystemOneEndpoint('https://my-llm.com/v1/systemone', 'auto'),
		'https://my-llm.com/v1/systemone',
	);

	// auto mode appends /v1/systemone if bare host
	t.is(
		resolveSystemOneEndpoint('https://my-llm.com', 'auto'),
		'https://my-llm.com/v1/systemone',
	);
});

test('SENSITIVE_COMMAND_REASON_CATEGORIES: contains stable predefined keys', t => {
	const keys = SENSITIVE_COMMAND_REASON_CATEGORIES.map(([key]) => key);
	t.true(keys.includes('readOnly'));
	t.true(keys.includes('regenerable'));
	t.true(keys.includes('scopedChange'));
	t.true(keys.includes('dataLoss'));
	t.true(keys.includes('systemState'));
	t.true(keys.includes('externalEffect'));
	t.true(keys.includes('unclear'));
});

test('StructuredPath invariant: workingDirectory contract in decision context', t => {
	const cwd = parseCanonicalPath('C:\\Projects\\MyApp');
	t.is(cwd.posix, 'C:/Projects/MyApp');
	t.true(cwd.isChildOf('C:/Projects'));
});
