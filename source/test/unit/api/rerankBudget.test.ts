import test from 'ava';
import {
	fitDocumentsToContext,
	resolveRerankEndpoint,
	normalizeRerankResponse,
} from '../../../api/rerank.js';

test('resolveRerankEndpoint: resolves standard, v1 and trailing slash combinations', t => {
	t.is(resolveRerankEndpoint('https://api.jina.ai'), 'https://api.jina.ai/v1/rerank');
	t.is(resolveRerankEndpoint('https://api.jina.ai/'), 'https://api.jina.ai/v1/rerank');
	t.is(resolveRerankEndpoint('https://api.jina.ai/v1'), 'https://api.jina.ai/v1/rerank');
	t.is(resolveRerankEndpoint('https://api.jina.ai/v1/rerank'), 'https://api.jina.ai/v1/rerank');
	t.is(resolveRerankEndpoint('https://api.cohere.com/rerank'), 'https://api.cohere.com/rerank');
});

test('normalizeRerankResponse: handles Jina/Cohere results object structure', t => {
	const rawJina = {
		results: [
			{index: 2, relevance_score: 0.98},
			{index: 0, relevanceScore: 0.75},
		],
	};
	const normalized = normalizeRerankResponse(rawJina);
	t.is(normalized.results.length, 2);
	t.is(normalized.results[0]?.index, 2);
	t.is(normalized.results[0]?.relevanceScore, 0.98);
	t.is(normalized.results[1]?.index, 0);
	t.is(normalized.results[1]?.relevanceScore, 0.75);
});

test('normalizeRerankResponse: handles top-level array results structure', t => {
	const rawArray = [
		{index: 1, score: 0.88},
		{index: 3, relevance_score: 0.42},
	];
	const normalized = normalizeRerankResponse(rawArray);
	t.is(normalized.results.length, 2);
	t.is(normalized.results[0]?.index, 1);
	t.is(normalized.results[0]?.relevanceScore, 0.88);
});

test('normalizeRerankResponse: throws descriptive error on unknown payload format', t => {
	t.throws(() => normalizeRerankResponse({invalid: 'payload'}), {
		message: /Unexpected rerank API response format/,
	});
});

test('fitDocumentsToContext: query budget exhaustion drops all documents safely', async t => {
	// contextLength is tiny (e.g. 50 tokens), 95% is 47, query tokens + overhead 50 will exceed budget
	const longQuery = 'A'.repeat(500);
	const docs = ['Doc 1', 'Doc 2'];
	const result = await fitDocumentsToContext(longQuery, docs, 50);

	t.is(result.documents.length, 0);
	t.is(result.originalIndices.length, 0);
	t.is(result.droppedCount, 2);
	t.is(result.truncatedCount, 0);
});

test('fitDocumentsToContext: truncates oversized single doc and drops doc when budget fills', async t => {
	// contextLength = 200 tokens.
	// budgetTotal = 200 * 0.95 = 190. Overhead = 50. Query ~ 4. Remaining budget ~ 136 tokens.
	// singleDocMax = 200 * 0.3 = 60 tokens.
	// Doc 0: 500 tokens -> truncated to 60 tokens. Remaining: ~76 tokens.
	// Doc 1: 50 tokens -> fits. Remaining: ~26 tokens.
	// Doc 2: 50 tokens -> exceeds remaining ~26 -> dropped!
	const query = 'test';
	const giantDoc = 'word '.repeat(500);
	const mediumDoc = 'medium '.repeat(45);
	const lateDoc = 'extra '.repeat(45);

	const docs = [giantDoc, mediumDoc, lateDoc];
	const result = await fitDocumentsToContext(query, docs, 200);

	t.is(result.truncatedCount, 1);
	t.true(result.documents.length >= 1);
	t.is(result.originalIndices[0], 0);
	t.is(result.droppedCount, 1);
});
