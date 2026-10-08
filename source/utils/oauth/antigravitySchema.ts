/**
 * Antigravity（Cloud Code Assist）工具参数 schema 清理器。
 *
 * 从 Snow App 的 native/src/api/gemini/antigravity_schema.rs 移植：
 * 上游（Gemini 3 / Claude 经 Code Assist）对 functionDeclarations 的 JSON Schema
 * 支持范围有限，需要展平 anyOf/oneOf、去掉不支持关键字，并为对象类型补占位必填字段。
 */

const UNSUPPORTED_KEYS = new Set([
	'$schema',
	'$id',
	'id',
	'$ref',
	'$defs',
	'definitions',
	'$anchor',
	'$vocabulary',
	'$dynamicRef',
	'$dynamicAnchor',
	'$comment',
	'const',
	'examples',
	'patternProperties',
	'additionalProperties',
	'propertyNames',
	'additionalItems',
	'unevaluatedProperties',
	'unevaluatedItems',
	'contentSchema',
	'uniqueItems',
	'minItems',
	'maxItems',
	'contains',
	'minLength',
	'maxLength',
	'minimum',
	'maximum',
	'exclusiveMinimum',
	'exclusiveMaximum',
	'multipleOf',
	'pattern',
	'format',
	'default',
	'if',
	'then',
	'else',
	'not',
	'enumDescriptions',
	'enumTitles',
	'prefill',
	'deprecated',
	'encrypted',
]);

const PLACEHOLDER_REASON_DESCRIPTION =
	'Brief explanation of why you are calling this tool';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function cleanToolSchema(
	schema: unknown,
	requirePlaceholder: boolean,
): unknown {
	const resolved = resolveRefs(schema, schema, []);
	return cleanNode(resolved, requirePlaceholder);
}

function resolveRefs(value: unknown, root: unknown, active: string[]): unknown {
	if (Array.isArray(value)) {
		return value.map(item => resolveRefs(item, root, active));
	}
	if (isObject(value)) {
		const reference =
			typeof value['$ref'] === 'string' ? (value['$ref'] as string) : '';
		if (reference.startsWith('#/')) {
			const target = resolvePointer(root, reference);
			if (target !== undefined) {
				if (active.includes(reference)) {
					return cyclicRefFallback(value, target, reference);
				}
				const nextActive = [...active, reference];
				const resolvedTarget = resolveRefs(target, root, nextActive);
				const merged: JsonObject = isObject(resolvedTarget)
					? {...resolvedTarget}
					: {};
				for (const [key, item] of Object.entries(value)) {
					if (key === '$ref') {
						continue;
					}
					merged[key] = resolveRefs(item, root, nextActive);
				}
				return merged;
			}
		}
		const resolved: JsonObject = {};
		for (const [key, item] of Object.entries(value)) {
			resolved[key] = resolveRefs(item, root, active);
		}
		return resolved;
	}
	return value;
}

function resolvePointer(root: unknown, reference: string): unknown {
	const path = reference.startsWith('#/') ? reference.slice(2) : null;
	if (path === null) {
		return undefined;
	}
	let current: unknown = root;
	for (const segment of path.split('/')) {
		const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
		if (isObject(current)) {
			current = current[key];
		} else if (Array.isArray(current)) {
			const index = Number.parseInt(key, 10);
			current = Number.isNaN(index) ? undefined : current[index];
		} else {
			return undefined;
		}
		if (current === undefined) {
			return undefined;
		}
	}
	return current;
}

function cyclicRefFallback(
	node: JsonObject,
	target: unknown,
	reference: string,
): JsonObject {
	const fallback: JsonObject = {};
	if (isObject(target)) {
		for (const key of ['type', 'nullable', 'description']) {
			if (key in target) {
				fallback[key] = target[key];
			}
		}
	}
	for (const [key, value] of Object.entries(node)) {
		if (key !== '$ref') {
			fallback[key] = value;
		}
	}
	const name = reference.split('/').pop() ?? reference;
	const hint = `See: ${name}`;
	const description =
		typeof fallback['description'] === 'string'
			? (fallback['description'] as string)
			: '';
	fallback['description'] = description ? `${description} (${hint})` : hint;
	return fallback;
}

function scalarToString(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'boolean' || typeof value === 'number') {
		return String(value);
	}
	if (value === null || value === undefined) {
		return '';
	}
	try {
		return JSON.stringify(value) ?? '';
	} catch {
		return String(value);
	}
}

function cleanNode(node: unknown, requirePlaceholder: boolean): unknown {
	if (!isObject(node)) {
		if (typeof node === 'boolean') {
			return {};
		}
		return node;
	}

	const cleaned: JsonObject = {...node};

	for (const key of ['anyOf', 'oneOf']) {
		if (key in cleaned) {
			const branches = cleaned[key];
			delete cleaned[key];
			flattenUnion(cleaned, branches, requirePlaceholder);
		}
	}
	if ('allOf' in cleaned) {
		const branches = cleaned['allOf'];
		delete cleaned['allOf'];
		mergeBranchList(cleaned, branches, requirePlaceholder);
	}
	for (const key of ['then', 'else']) {
		if (key in cleaned) {
			const branch = cleaned[key];
			delete cleaned[key];
			mergeBranch(cleaned, branch, requirePlaceholder);
		}
	}

	if ('const' in cleaned) {
		const value = cleaned['const'];
		delete cleaned['const'];
		if (!('enum' in cleaned)) {
			cleaned['enum'] = [value];
		}
	}
	if (Array.isArray(cleaned['enum'])) {
		cleaned['enum'] = (cleaned['enum'] as unknown[]).map(value =>
			typeof value === 'string' ? value : scalarToString(value),
		);
	}

	let nullable =
		typeof cleaned['nullable'] === 'boolean'
			? (cleaned['nullable'] as boolean)
			: false;
	if (Array.isArray(cleaned['type'])) {
		const types = cleaned['type'] as unknown[];
		const nonNullTypes: string[] = [];
		for (const item of types) {
			const name = typeof item === 'string' ? item : '';
			if (name === 'null') {
				nullable = true;
			} else if (name) {
				nonNullTypes.push(name);
			}
		}
		let chosen: string;
		if ('items' in cleaned && nonNullTypes.includes('array')) {
			chosen = 'array';
		} else if ('properties' in cleaned && nonNullTypes.includes('object')) {
			chosen = 'object';
		} else {
			chosen = nonNullTypes[0] ?? 'string';
		}
		cleaned['type'] = chosen;
	}
	if (nullable) {
		cleaned['nullable'] = true;
	}

	for (const key of UNSUPPORTED_KEYS) {
		delete cleaned[key];
	}
	for (const key of Object.keys(cleaned)) {
		if (key.startsWith('x-')) {
			delete cleaned[key];
		}
	}

	if (isObject(cleaned['properties'])) {
		if (cleaned['type'] !== 'object') {
			cleaned['type'] = 'object';
		}
	}

	const typeName =
		typeof cleaned['type'] === 'string'
			? (cleaned['type'] as string)
			: undefined;
	if (typeName === 'array') {
		if (!('items' in cleaned)) {
			cleaned['items'] = {type: 'string'};
		}
	} else if (typeName !== undefined) {
		delete cleaned['items'];
	} else if ('items' in cleaned) {
		cleaned['type'] = 'array';
	}

	if (isObject(cleaned['properties'])) {
		const properties = cleaned['properties'] as JsonObject;
		const sanitized: JsonObject = {};
		for (const [name, schema] of Object.entries(properties)) {
			sanitized[name] = cleanNode(schema, requirePlaceholder);
		}
		cleaned['properties'] = sanitized;
	}
	if ('items' in cleaned) {
		const items = cleaned['items'];
		cleaned['items'] = Array.isArray(items)
			? items.map(item => cleanNode(item, requirePlaceholder))
			: cleanNode(items, requirePlaceholder);
	}

	if (Array.isArray(cleaned['required'])) {
		const properties = isObject(cleaned['properties'])
			? (cleaned['properties'] as JsonObject)
			: undefined;
		if (properties) {
			const filtered = (cleaned['required'] as unknown[]).filter(
				name => typeof name === 'string' && name in properties,
			);
			if (filtered.length === 0) {
				delete cleaned['required'];
			} else {
				cleaned['required'] = filtered;
			}
		} else {
			delete cleaned['required'];
		}
	}

	if (!requirePlaceholder) {
		delete cleaned['title'];
	}

	if (requirePlaceholder && cleaned['type'] === 'object') {
		addPlaceholder(cleaned);
	}

	return cleaned;
}

function addPlaceholder(node: JsonObject): void {
	const properties = isObject(node['properties'])
		? (node['properties'] as JsonObject)
		: {};
	const propertyCount = Object.keys(properties).length;
	const required = Array.isArray(node['required'])
		? (node['required'] as unknown[])
		: [];
	const hasRequired = required.length > 0;

	if (propertyCount === 0) {
		node['properties'] = {
			reason: {
				type: 'string',
				description: PLACEHOLDER_REASON_DESCRIPTION,
			},
		};
		node['required'] = ['reason'];
		return;
	}

	if (!hasRequired) {
		properties['_'] = {type: 'boolean'};
		node['properties'] = properties;
		node['required'] = ['_'];
	}
}

function flattenUnion(
	parent: JsonObject,
	branches: unknown,
	requirePlaceholder: boolean,
): void {
	if (!Array.isArray(branches) || branches.length === 0) {
		return;
	}

	const cleaned = branches.map(item => cleanNode(item, requirePlaceholder));
	const hasNull = cleaned.some(
		item => isObject(item) && item['type'] === 'null',
	);

	const parentProperties = isObject(parent['properties'])
		? (parent['properties'] as JsonObject)
		: undefined;
	const parentHasProperties =
		!!parentProperties && Object.keys(parentProperties).length > 0;

	if (parentHasProperties) {
		const target = parent['properties'] as JsonObject;
		for (const branch of cleaned) {
			if (!isObject(branch) || !isObject(branch['properties'])) {
				continue;
			}
			for (const [name, schema] of Object.entries(
				branch['properties'] as JsonObject,
			)) {
				if (!(name in target)) {
					target[name] = schema;
				}
			}
		}
		if (hasNull) {
			parent['nullable'] = true;
		}
		if (!('type' in parent)) {
			parent['type'] = 'object';
		}
		return;
	}

	let bestIndex = 0;
	let bestScore = -1;
	cleaned.forEach((item, index) => {
		const score = branchScore(item);
		if (score > bestScore) {
			bestScore = score;
			bestIndex = index;
		}
	});
	const selected = cleaned[bestIndex];
	const selectedIsNull = isObject(selected) && selected['type'] === 'null';

	const merged: JsonObject = isObject(selected) ? {...selected} : {};
	for (const [key, value] of Object.entries(parent)) {
		if (key === 'anyOf' || key === 'oneOf') {
			continue;
		}
		if (!(key in merged)) {
			merged[key] = value;
		}
	}
	if (hasNull && !selectedIsNull) {
		merged['nullable'] = true;
	}
	for (const key of Object.keys(parent)) {
		delete parent[key];
	}
	Object.assign(parent, merged);
}

function branchScore(item: unknown): number {
	if (!isObject(item)) {
		return 1;
	}
	const type = item['type'];
	if (type === 'object') {
		return 3;
	}
	if (type === 'array') {
		return 2;
	}
	if (type === 'null') {
		return 0;
	}
	if (typeof type === 'string') {
		return 1;
	}
	if ('properties' in item) {
		return 3;
	}
	if ('items' in item) {
		return 2;
	}
	return 1;
}

function mergeBranchList(
	parent: JsonObject,
	branches: unknown,
	requirePlaceholder: boolean,
): void {
	if (!Array.isArray(branches)) {
		return;
	}
	for (const item of branches) {
		mergeBranch(parent, item, requirePlaceholder);
	}
}

function mergeBranch(
	parent: JsonObject,
	branch: unknown,
	requirePlaceholder: boolean,
): void {
	const cleaned = cleanNode(branch, requirePlaceholder);
	if (!isObject(cleaned)) {
		return;
	}
	for (const [key, value] of Object.entries(cleaned)) {
		if (key === 'required') {
			if (!Array.isArray(value)) {
				continue;
			}
			const required = Array.isArray(parent['required'])
				? ([...(parent['required'] as unknown[])] as unknown[])
				: [];
			for (const name of value) {
				if (!required.some(existing => existing === name)) {
					required.push(name);
				}
			}
			if (required.length > 0) {
				parent['required'] = required;
			}
			continue;
		}
		if (key === 'properties') {
			if (!isObject(value)) {
				continue;
			}
			const target = isObject(parent['properties'])
				? (parent['properties'] as JsonObject)
				: {};
			for (const [name, schema] of Object.entries(value)) {
				if (!(name in target)) {
					target[name] = schema;
				}
			}
			parent['properties'] = target;
			continue;
		}
		if (!(key in parent)) {
			parent[key] = value;
		}
	}
}
