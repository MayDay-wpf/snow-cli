/**
 * 数据库连接串脱敏：key=value 串（ADO.NET / ODBC / JDBC / libpq）、URI 串、
 * Oracle thin 串。只遮罩主机、用户名、密码，库名与端口保留。
 *
 * 移植自 snow-app `native/src/mcp/privacy_mask/db_connection.rs`。
 */
import {
	addSensitiveMatch,
	isDefinitelyCode,
	isPlaceholderSecret,
	shouldMaskContextValue,
	type SensitiveMatch,
} from './privacyMask.js';

export const DB_CONNECTION_MATCH_TYPE = 'db_connection';
const CONFIDENCE = 0.97;
/** 同一连接串内相邻键值对的最大间距（字符）。 */
const MAX_PAIR_GAP = 160;
const HOST_PROTOCOL_PREFIXES = ['tcp:', 'np:', 'lpc:', 'admin:'];

type KeyKind = 'host' | 'user' | 'password' | 'other';

interface KeyHit {
	keyStart: number;
	end: number;
	kind: KeyKind;
	/** password / passwd 即使单独出现也遮罩 */
	standalone: boolean;
	value: [number, number] | null;
}

const KV_KEY_PATTERN =
	/(?:^|[^A-Za-z0-9_.]|\\[nrt])(data[ \t]*source|network[ \t]*address|host[ \t]*name|hostaddr|host|server|address|addr|user[ \t]*id|user[ \t]*name|user|uid|password|passwd|pwd|initial[ \t]*catalog|database[ \t]*name|database|dbname|port|provider|driver|dsn|integrated[ \t]*security|trusted[_ \t]*connection|encrypt|trust[ \t]*server[ \t]*certificate|persist[ \t]*security[ \t]*info|connect(?:ion)?[ \t]*timeout|sslmode|charset|pooling|application[ \t]*name|multiple[ \t]*active[ \t]*result[ \t]*sets|auth[ \t]*source|service[ \t]*name|sid)[ \t]*=/gi;
const KV_KEY_SUFFIX_PATTERN = /[ \t]*=$/;

const URI_PATTERN =
	/\b(jdbc(?::[a-z][a-z0-9+.\-]*)+|[a-z][a-z0-9+.\-]*):\/\/([^\s/?#"'`<>\\;]+)/gi;

const ORACLE_THIN_PATTERN =
	/\bjdbc:oracle:[a-z]+:(?:([^\s/@:;"'`<>\\]+)\/([^\s@;"'`<>\\]+))?@(?:\/\/)?(\[[0-9a-f:.]+\]|[a-z0-9_.\-]+)/gi;
const ORACLE_THIN_PREFIX_PATTERN = /^jdbc:oracle:[a-z]+:/i;

const DB_SCHEMES = new Set([
	'postgres',
	'postgresql',
	'pgsql',
	'mysql',
	'mysqlx',
	'mariadb',
	'mongodb',
	'redis',
	'rediss',
	'valkey',
	'amqp',
	'amqps',
	'mssql',
	'sqlserver',
	'oracle',
	'clickhouse',
	'cockroachdb',
	'couchdb',
	'couchbase',
	'couchbases',
	'neo4j',
	'bolt',
	'cassandra',
	'db2',
	'tidb',
	'influxdb',
	'memcached',
	'nats',
	'kafka',
	'mqtt',
	'ldap',
	'ldaps',
]);

function keyKind(key: string): {kind: KeyKind; standalone: boolean} {
	const normalized = key.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
	switch (normalized) {
		case 'datasource':
		case 'networkaddress':
		case 'hostname':
		case 'hostaddr':
		case 'host':
		case 'server':
		case 'address':
		case 'addr':
			return {kind: 'host', standalone: false};
		case 'userid':
		case 'username':
		case 'user':
		case 'uid':
			return {kind: 'user', standalone: false};
		case 'password':
		case 'passwd':
			return {kind: 'password', standalone: true};
		case 'pwd':
			return {kind: 'password', standalone: false};
		default:
			return {kind: 'other', standalone: false};
	}
}

/** 真实换行或 JSON 转义后的 `\n` / `\r`。 */
function isLineBreakAt(text: string, i: number): boolean {
	const ch = text[i];
	if (ch === '\n' || ch === '\r') {
		return true;
	}
	if (ch === '\\') {
		const next = text[i + 1];
		return next === 'n' || next === 'r';
	}
	return false;
}

const QUOTE_CLOSED_FOLLOWERS = new Set([
	';',
	' ',
	'\t',
	'\r',
	'\n',
	'\\',
	'"',
	"'",
	',',
	')',
	'}',
	'&',
]);

/** 解析 `key=` 之后的值，返回值的区间（不含引号）。 */
function parseValue(
	text: string,
	from: number,
	kind: KeyKind,
): [number, number] | null {
	let i = from;
	while (i < text.length && (text[i] === ' ' || text[i] === '\t')) {
		i++;
	}
	if (i >= text.length) {
		return null;
	}
	const first = text[i];
	// `==` 是比较运算
	if (first === '=') {
		return null;
	}

	let quote: {close: string; openLength: number} | null = null;
	if (first === '"') {
		quote = {close: '"', openLength: 1};
	} else if (first === "'") {
		quote = {close: "'", openLength: 1};
	} else if (first === '{') {
		quote = {close: '}', openLength: 1};
	} else if (first === '\\' && text[i + 1] === '"') {
		quote = {close: '\\"', openLength: 2};
	}

	if (quote) {
		const {close, openLength} = quote;
		const start = i + openLength;
		let j = start;
		while (j < text.length) {
			if (isLineBreakAt(text, j)) {
				return null;
			}
			if (text.startsWith(close, j)) {
				// 连写两次视为转义（ADO.NET / ODBC 规则）
				if (close.length === 1 && text[j + 1] === close) {
					j += 2;
					continue;
				}
				const after = j + close.length;
				const closed =
					after >= text.length || QUOTE_CLOSED_FOLLOWERS.has(text[after]!);
				return closed && j > start ? [start, j] : null;
			}
			j++;
		}
		return null;
	}

	let j = i;
	while (j < text.length) {
		const ch = text[j]!;
		if (
			ch === ';' ||
			ch === '\r' ||
			ch === '\n' ||
			ch === '"' ||
			ch === "'" ||
			ch === '`'
		) {
			break;
		}
		if (ch === '\\' && /^[nrt"u]$/.test(text[j + 1] ?? '')) {
			break;
		}
		if (
			kind !== 'password' &&
			(ch === '&' || ch === ')' || ch === '<' || ch === '>' || ch === '}')
		) {
			break;
		}
		j++;
	}

	let end = j;
	// libpq 空格分隔：后续 token 仍含 `=` 时在首个空白处截断
	const segment = text.slice(i, end);
	const wsIndex = segment.search(/[ \t]/);
	if (wsIndex >= 0 && segment.slice(wsIndex).includes('=')) {
		end = i + wsIndex;
	}
	while (
		end > i &&
		(text[end - 1] === ' ' ||
			text[end - 1] === '\t' ||
			(kind !== 'password' && text[end - 1] === ','))
	) {
		end--;
	}
	return end > i ? [i, end] : null;
}

function isAdjacent(text: string, prevEnd: number, nextStart: number): boolean {
	if (prevEnd >= nextStart) {
		return true;
	}
	if (nextStart - prevEnd > MAX_PAIR_GAP) {
		return false;
	}
	for (let i = prevEnd; i < nextStart; i++) {
		if (isLineBreakAt(text, i)) {
			return false;
		}
	}
	return true;
}

function isLocalHost(host: string): boolean {
	const lower = host.trim().toLowerCase();
	return (
		lower === 'localhost' ||
		lower === '127.0.0.1' ||
		lower === '::1' ||
		lower === '[::1]' ||
		lower === '.' ||
		lower === '(local)' ||
		lower.startsWith('(localdb)')
	);
}

/** `host:port` 只保留主机部分长度（IPv6 需带方括号）。 */
function stripPortLength(item: string): number {
	if (item.startsWith('[')) {
		const close = item.indexOf(']');
		return close >= 0 ? close + 1 : item.length;
	}
	const colon = item.lastIndexOf(':');
	if (
		colon >= 0 &&
		!item.slice(0, colon).includes(':') &&
		/^\d*$/.test(item.slice(colon + 1))
	) {
		return colon;
	}
	return item.length;
}

function pushSpan(
	text: string,
	start: number,
	end: number,
	matches: SensitiveMatch[],
): void {
	if (end > start && !isPlaceholderSecret(text.slice(start, end))) {
		addSensitiveMatch(
			matches,
			start,
			end,
			DB_CONNECTION_MATCH_TYPE,
			CONFIDENCE,
		);
	}
}

/** 逗号分隔的主机列表，逐个去掉端口后遮罩。 */
function maskHostList(
	text: string,
	start: number,
	end: number,
	matches: SensitiveMatch[],
): void {
	let pos = start;
	for (const item of text.slice(start, end).split(',')) {
		const hostLength = stripPortLength(item);
		const host = item.slice(0, hostLength);
		if (host.trim() && !isLocalHost(host)) {
			pushSpan(text, pos, pos + hostLength, matches);
		}
		pos += item.length + 1;
	}
}

/** key=value 中的主机值：去掉 `tcp:` 等前缀，SQL Server 的 `,端口` 保留。 */
function maskKvHost(
	text: string,
	start: number,
	end: number,
	matches: SensitiveMatch[],
): void {
	const lower = text.slice(start, end).toLowerCase();
	const prefix = HOST_PROTOCOL_PREFIXES.find(item => lower.startsWith(item));
	const hostStart = start + (prefix?.length ?? 0);
	const rest = text.slice(hostStart, end);
	const comma = rest.indexOf(',');
	if (comma >= 0) {
		const port = rest.slice(comma + 1).trim();
		if (port && /^\d+$/.test(port)) {
			maskHostList(text, hostStart, hostStart + comma, matches);
			return;
		}
	}
	maskHostList(text, hostStart, end, matches);
}

function maskKvHit(
	text: string,
	hit: KeyHit,
	grouped: boolean,
	matches: SensitiveMatch[],
): void {
	if (!hit.value) {
		return;
	}
	const [start, end] = hit.value;
	const value = text.slice(start, end);
	if (isPlaceholderSecret(value)) {
		return;
	}
	// 主机/用户名是函数调用等代码表达式时跳过
	if (
		(hit.kind === 'host' || hit.kind === 'user') &&
		isDefinitelyCode(value.trim())
	) {
		return;
	}

	switch (hit.kind) {
		case 'password':
			if (
				grouped ||
				(hit.standalone && shouldMaskContextValue(value, 'password'))
			) {
				pushSpan(text, start, end, matches);
			}
			break;
		case 'user':
			if (grouped) {
				pushSpan(text, start, end, matches);
			}
			break;
		case 'host':
			if (grouped) {
				maskKvHost(text, start, end, matches);
			}
			break;
		default:
			break;
	}
}

/** 同一行内出现 >= 2 个连接串键才视为连接串，避免误伤普通 `host=` 配置。 */
function collectKvMatches(text: string, matches: SensitiveMatch[]): void {
	const hits: KeyHit[] = [];
	KV_KEY_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = KV_KEY_PATTERN.exec(text)) !== null) {
		const whole = match[0];
		const key = match[1];
		if (!key) {
			continue;
		}
		const wholeEnd = match.index + whole.length;
		const suffixLength = KV_KEY_SUFFIX_PATTERN.exec(whole)?.[0].length ?? 1;
		const keyStart = wholeEnd - suffixLength - key.length;
		const {kind, standalone} = keyKind(key);
		const value = parseValue(text, wholeEnd, kind);
		hits.push({
			keyStart,
			end: value ? value[1] : wholeEnd,
			kind,
			standalone,
			value,
		});
	}

	let groupStart = 0;
	for (let index = 0; index <= hits.length; index++) {
		const split =
			index === hits.length ||
			(index > groupStart &&
				!isAdjacent(text, hits[index - 1]!.end, hits[index]!.keyStart));
		if (!split) {
			continue;
		}
		const group = hits.slice(groupStart, index);
		const grouped = group.length >= 2;
		for (const hit of group) {
			maskKvHit(text, hit, grouped, matches);
		}
		groupStart = index;
	}
}

function isDbScheme(scheme: string): boolean {
	const lower = scheme.toLowerCase();
	if (lower.startsWith('jdbc:')) {
		return true;
	}
	return DB_SCHEMES.has(lower.split('+')[0] ?? '');
}

/**
 * `scheme://****:****@host:port/db`：数据库协议遮罩用户/密码/主机，
 * 其他协议仅在带密码时遮罩用户和密码。
 */
function collectUriMatches(text: string, matches: SensitiveMatch[]): void {
	URI_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = URI_PATTERN.exec(text)) !== null) {
		const scheme = match[1];
		const authority = match[2];
		if (!scheme || !authority) {
			continue;
		}
		const db = isDbScheme(scheme);
		const authEnd = match.index + match[0].length;
		const authStart = authEnd - authority.length;
		const atOffset = authority.lastIndexOf('@');
		const at = atOffset >= 0 ? authStart + atOffset : -1;
		const hostsStart = at >= 0 ? at + 1 : authStart;

		if (at >= 0) {
			const userinfo = text.slice(authStart, at);
			const colon = userinfo.indexOf(':');
			const user: [number, number] =
				colon >= 0 ? [authStart, authStart + colon] : [authStart, at];
			const pass: [number, number] | null =
				colon >= 0 ? [authStart + colon + 1, at] : null;
			const hasPass =
				pass !== null &&
				pass[1] > pass[0] &&
				!isPlaceholderSecret(text.slice(pass[0], pass[1]));
			if (hasPass || db) {
				pushSpan(text, user[0], user[1], matches);
				if (pass) {
					pushSpan(text, pass[0], pass[1], matches);
				}
			}
		}
		if (db) {
			maskHostList(text, hostsStart, authEnd, matches);
		}
	}
}

/** `jdbc:oracle:thin:****\/****@****:1521:sid` 与 `jdbc:oracle:thin:@//****:1521/svc`。 */
function collectOracleMatches(text: string, matches: SensitiveMatch[]): void {
	ORACLE_THIN_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = ORACLE_THIN_PATTERN.exec(text)) !== null) {
		const user = match[1];
		const pass = match[2];
		const host = match[3];
		if (user && pass) {
			const prefixLength =
				ORACLE_THIN_PREFIX_PATTERN.exec(match[0])?.[0].length ?? 0;
			const userStart = match.index + prefixLength;
			const passStart = userStart + user.length + 1;
			pushSpan(text, userStart, userStart + user.length, matches);
			pushSpan(text, passStart, passStart + pass.length, matches);
		}
		if (host && !isLocalHost(host)) {
			const hostEnd = match.index + match[0].length;
			pushSpan(text, hostEnd - host.length, hostEnd, matches);
		}
	}
}

export function collectDbConnectionMatches(
	text: string,
	matches: SensitiveMatch[],
): void {
	if (text.includes('=')) {
		collectKvMatches(text, matches);
	}
	if (text.includes('://')) {
		collectUriMatches(text, matches);
	}
	if (text.includes('@')) {
		collectOracleMatches(text, matches);
	}
}
