import test from 'ava';
import {
	resolveApiEndpoint,
	normalizeBaseUrlValue,
} from '../../../api/endpointResolver.js';

test('endpointResolver normalizes and routes OpenAI, Anthropic, Gemini endpoints', t => {
	t.is(normalizeBaseUrlValue('https://api.openai.com/v1/  '), 'https://api.openai.com/v1');

	// Auto mode appending chat
	const chatUrl = resolveApiEndpoint('https://api.openai.com/v1', 'chat', 'auto');
	t.is(chatUrl, 'https://api.openai.com/v1/chat/completions');

	// If already a full chat endpoint, do not append duplicate suffix
	const dupChatUrl = resolveApiEndpoint(
		'https://api.openai.com/v1/chat/completions',
		'chat',
		'auto',
	);
	t.is(dupChatUrl, 'https://api.openai.com/v1/chat/completions');

	// Anthropic messages endpoint
	const anthropicUrl = resolveApiEndpoint(
		'https://api.anthropic.com/v1',
		'anthropicMessages',
		'auto',
		{anthropicBeta: true},
	);
	t.is(anthropicUrl, 'https://api.anthropic.com/v1/messages?beta=true');

	// Gemini stream generate content
	const geminiUrl = resolveApiEndpoint(
		'https://generativelanguage.googleapis.com/v1beta',
		'geminiStreamGenerateContent',
		'auto',
		{modelName: 'gemini-1.5-pro'},
	);
	t.is(
		geminiUrl,
		'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:streamGenerateContent?alt=sse',
	);
});
