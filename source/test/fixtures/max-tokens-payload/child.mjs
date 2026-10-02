// 回归测试夹具：在独立子进程中运行，避免污染 AVA 主进程环境。
//
// 场景：配置项「最大回复令牌数」(snowcfg.maxTokens) 必须落到各请求方式的正确字段：
//   chat      -> max_tokens
//   responses -> max_output_tokens
//   gemini    -> generationConfig.maxOutputTokens
// 并且未配置 maxTokens 时不应发送该字段（避免把 undefined/0 传给远端）。
//
// 运行方式（由 max-tokens-payload.test.ts 拉起）：
//   node --loader=ts-node/esm source/test/fixtures/max-tokens-payload/child.mjs <sandboxDir>
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const sandboxDir = process.argv[2];
if (!sandboxDir) {
	throw new Error('sandbox dir argument is required');
}

process.env['SNOW_CONFIG_DIR'] = sandboxDir;
mkdirSync(sandboxDir, {recursive: true});

const writeConfig = (snowcfg, geminiThinking) =>
	writeFileSync(
		join(sandboxDir, 'config.json'),
		JSON.stringify({snowcfg: {...snowcfg, geminiThinking}}),
	);

const requests = [];
globalThis.fetch = async (url, options) => {
	requests.push({url: String(url), body: JSON.parse(options.body)});
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
			controller.close();
		},
	});
	return new Response(stream, {
		status: 200,
		headers: {'content-type': 'text/event-stream'},
	});
};

const base = {
	baseUrl: 'https://api.example.com/v1',
	baseUrlMode: 'auto',
	apiKey: 'KEY-TEST',
	advancedModel: 'test-model',
};

const messages = [{role: 'user', content: 'hi'}];
const drain = async stream => {
	try {
		for await (const _chunk of stream) {
			// 只要请求被发出即可，响应体内容无关
		}
	} catch {}
};

const {createStreamingChatCompletion} = await import(
	'../../../../source/api/chat.js'
);
const {createStreamingResponse} = await import(
	'../../../../source/api/responses.js'
);
const {createStreamingGeminiCompletion} = await import(
	'../../../../source/api/gemini.js'
);

const MAX_TOKENS = 12345;

// ---- 配置了 maxTokens ----
writeConfig({...base, requestMethod: 'chat', maxTokens: MAX_TOKENS});
await drain(
	createStreamingChatCompletion({model: 'm', messages, max_tokens: MAX_TOKENS}),
);
await drain(
	createStreamingResponse({model: 'm', messages, max_tokens: MAX_TOKENS}),
);
await drain(
	createStreamingGeminiCompletion({
		model: 'm',
		messages,
		max_tokens: MAX_TOKENS,
	}),
);

// ---- 未配置 maxTokens：字段必须缺失 ----
await drain(createStreamingChatCompletion({model: 'm', messages}));
await drain(createStreamingResponse({model: 'm', messages}));
await drain(createStreamingGeminiCompletion({model: 'm', messages}));

// ---- gemini 思考 + maxTokens 共存于 generationConfig ----
// 注意：配置会被同进程缓存，改写 config.json 后需要清缓存重新加载
writeConfig(
	{...base, requestMethod: 'gemini'},
	{enabled: true, thinkingLevel: 'low'},
);
const {clearConfigCache} = await import(
	'../../../../source/utils/config/apiConfig.js'
);
clearConfigCache();
await drain(
	createStreamingGeminiCompletion({
		model: 'm',
		messages,
		max_tokens: MAX_TOKENS,
	}),
);

const result = {
	chat: {
		max_tokens: requests[0]?.body?.max_tokens,
		url: requests[0]?.url,
	},
	responses: {
		max_output_tokens: requests[1]?.body?.max_output_tokens,
		url: requests[1]?.url,
	},
	gemini: {
		generationConfig: requests[2]?.body?.generationConfig,
		url: requests[2]?.url,
	},
	unset: {
		chat: requests[3]?.body?.max_tokens,
		responses: requests[4]?.body?.max_output_tokens,
		gemini: requests[5]?.body?.generationConfig,
	},
	geminiWithThinking: requests[6]?.body?.generationConfig,
	requestCount: requests.length,
};

process.stdout.write(`FIXTURE_RESULT ${JSON.stringify(result)}\n`);
