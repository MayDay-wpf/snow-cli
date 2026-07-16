import anyTest, {type TestFn} from 'ava';

import {SSEServer} from '../api/sse-server.js';

const test = anyTest as unknown as TestFn;
const jsonHeaders = {'Content-Type': 'application/json'};

test.serial(
	'SSE protects all control endpoints when a token is configured',
	async t => {
		const previousToken = process.env['SNOW_SSE_TOKEN'];
		const previousOrigins = process.env['SNOW_SSE_ALLOWED_ORIGINS'];
		process.env['SNOW_SSE_TOKEN'] = 'sse-test-token';
		process.env['SNOW_SSE_ALLOWED_ORIGINS'] = 'http://localhost:5173';
		const server = new SSEServer(0);

		try {
			await server.start();
			const baseUrl = `http://127.0.0.1:${server.getListeningPort()}`;

			const health = await fetch(`${baseUrl}/health`);
			t.is(health.status, 200);

			const unauthorized = await fetch(`${baseUrl}/session/list`);
			t.is(unauthorized.status, 401);

			const forbiddenOrigin = await fetch(`${baseUrl}/session/list`, {
				headers: {
					Authorization: 'Bearer sse-test-token',
					Origin: 'https://evil.example',
				},
			});
			t.is(forbiddenOrigin.status, 403);

			const authorized = await fetch(`${baseUrl}/session/list`, {
				headers: {
					Authorization: 'Bearer sse-test-token',
					Origin: 'http://localhost:5173',
				},
			});
			t.is(authorized.status, 200);

			const oversized = await fetch(`${baseUrl}/message`, {
				method: 'POST',
				headers: {
					...jsonHeaders,
					Authorization: 'Bearer sse-test-token',
					Origin: 'http://localhost:5173',
				},
				body: JSON.stringify({type: 'chat', content: 'x'.repeat(1024 * 1024)}),
			});
			t.is(oversized.status, 413);
		} finally {
			await server.stop();
			if (previousToken === undefined) {
				delete process.env['SNOW_SSE_TOKEN'];
			} else {
				process.env['SNOW_SSE_TOKEN'] = previousToken;
			}
			if (previousOrigins === undefined) {
				delete process.env['SNOW_SSE_ALLOWED_ORIGINS'];
			} else {
				process.env['SNOW_SSE_ALLOWED_ORIGINS'] = previousOrigins;
			}
		}
	},
);

test.serial(
	'SSE rejects browser origins unless explicitly allowlisted',
	async t => {
		const previousToken = process.env['SNOW_SSE_TOKEN'];
		const previousOrigins = process.env['SNOW_SSE_ALLOWED_ORIGINS'];
		delete process.env['SNOW_SSE_TOKEN'];
		delete process.env['SNOW_SSE_ALLOWED_ORIGINS'];
		const server = new SSEServer(0);

		try {
			await server.start();
			const response = await fetch(
				`http://127.0.0.1:${server.getListeningPort()}/session/list`,
				{headers: {Origin: 'http://localhost:5173'}},
			);
			t.is(response.status, 403);
		} finally {
			await server.stop();
			if (previousToken === undefined) {
				delete process.env['SNOW_SSE_TOKEN'];
			} else {
				process.env['SNOW_SSE_TOKEN'] = previousToken;
			}
			if (previousOrigins === undefined) {
				delete process.env['SNOW_SSE_ALLOWED_ORIGINS'];
			} else {
				process.env['SNOW_SSE_ALLOWED_ORIGINS'] = previousOrigins;
			}
		}
	},
);

test.serial(
	'SSE request confirm is not trusted without transport auth',
	async t => {
		const previousToken = process.env['SNOW_SSE_TOKEN'];
		delete process.env['SNOW_SSE_TOKEN'];
		const server = new SSEServer(0);

		try {
			await server.start();
			const response = await fetch(
				`http://127.0.0.1:${server.getListeningPort()}/session/command`,
				{
					method: 'POST',
					headers: jsonHeaders,
					body: JSON.stringify({
						command: 'buddy.reset',
						args: 'status',
						confirm: true,
					}),
				},
			);
			t.is(response.status, 400);
			const result = (await response.json()) as {code?: string};
			t.is(result.code, 'CONFIRMATION_REQUIRED');
		} finally {
			await server.stop();
			if (previousToken === undefined) {
				delete process.env['SNOW_SSE_TOKEN'];
			} else {
				process.env['SNOW_SSE_TOKEN'] = previousToken;
			}
		}
	},
);
