/**
 * 飞书长连接帧编解码（pbbp2.Frame，私有 protobuf）。
 *
 * 字段号与官方 SDK（oapi-sdk-go 的 ws/pbbp2）一致：
 *   1 SeqID / 2 LogID / 3 service / 4 method / 5 headers / 8 payload
 *   Header：1 key / 2 value
 *
 * method 0 是控制帧（type=ping/pong），1 是数据帧（type=event/card）。
 */

const WIRE_VARINT = 0;
const WIRE_BYTES = 2;
const WIRE_FIXED32 = 5;
const WIRE_FIXED64 = 1;

const FRAME_FIELD = {
	seqId: 1,
	logId: 2,
	service: 3,
	method: 4,
	headers: 5,
	payloadEncoding: 6,
	payloadType: 7,
	payload: 8,
} as const;

const HEADER_FIELD = {key: 1, value: 2} as const;

const VARINT_TARGETS: Record<number, 'seqId' | 'logId' | 'service' | 'method'> = {
	[FRAME_FIELD.seqId]: 'seqId',
	[FRAME_FIELD.logId]: 'logId',
	[FRAME_FIELD.service]: 'service',
	[FRAME_FIELD.method]: 'method',
};

export interface FeishuFrameHeader {
	key: string;
	value: string;
}

export interface FeishuFrame {
	seqId: number;
	logId: number;
	service: number;
	method: number;
	headers: FeishuFrameHeader[];
	payloadEncoding: string;
	payloadType: string;
	payload: Buffer | null;
}

function encodeVarint(input: number): Buffer {
	let value = Math.floor(input);
	if (!Number.isFinite(value) || value < 0) {
		value = 0;
	}
	const bytes: number[] = [];
	while (value > 0x7f) {
		bytes.push((value & 0x7f) | 0x80);
		value = Math.floor(value / 128);
	}
	bytes.push(value & 0x7f);
	return Buffer.from(bytes);
}

function encodeTag(field: number, wireType: number): Buffer {
	return encodeVarint(field * 8 + wireType);
}

function encodeBytes(field: number, value: Buffer | string): Buffer {
	const body = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
	return Buffer.concat([encodeTag(field, WIRE_BYTES), encodeVarint(body.length), body]);
}

function encodeHeader(header: FeishuFrameHeader): Buffer {
	return Buffer.concat([
		encodeBytes(HEADER_FIELD.key, header.key ?? ''),
		encodeBytes(HEADER_FIELD.value, header.value ?? ''),
	]);
}

export function encodeFeishuFrame(options: {
	seqId?: number;
	logId?: number;
	service?: number;
	method?: number;
	headers?: FeishuFrameHeader[];
	payload?: Buffer | null;
}): Buffer {
	const {
		seqId = 0,
		logId = 0,
		service = 0,
		method = 0,
		headers = [],
		payload = null,
	} = options;

	const parts = [
		encodeTag(FRAME_FIELD.seqId, WIRE_VARINT),
		encodeVarint(seqId),
		encodeTag(FRAME_FIELD.logId, WIRE_VARINT),
		encodeVarint(logId),
		encodeTag(FRAME_FIELD.service, WIRE_VARINT),
		encodeVarint(service),
		encodeTag(FRAME_FIELD.method, WIRE_VARINT),
		encodeVarint(method),
	];

	for (const header of headers) {
		const body = encodeHeader(header);
		parts.push(
			encodeTag(FRAME_FIELD.headers, WIRE_BYTES),
			encodeVarint(body.length),
			body,
		);
	}

	if (payload && payload.length > 0) {
		parts.push(encodeBytes(FRAME_FIELD.payload, payload));
	}

	return Buffer.concat(parts);
}

function readVarint(buffer: Buffer, start: number): {value: number; pos: number} {
	let value = 0;
	let shift = 0;
	let pos = start;
	while (pos < buffer.length) {
		const byte = buffer[pos]!;
		pos += 1;
		value += (byte & 0x7f) * 2 ** shift;
		if ((byte & 0x80) === 0) {
			return {value, pos};
		}
		shift += 7;
		if (shift > 63) {
			break;
		}
	}
	throw new Error('帧字段长度非法');
}

function decodeHeader(buffer: Buffer): FeishuFrameHeader {
	const header: FeishuFrameHeader = {key: '', value: ''};
	let pos = 0;
	while (pos < buffer.length) {
		const tag = readVarint(buffer, pos);
		pos = tag.pos;
		const field = Math.floor(tag.value / 8);
		const wireType = tag.value % 8;
		if (wireType !== WIRE_BYTES) {
			throw new Error(`帧头字段使用了不支持的编码（field=${field}）`);
		}
		const length = readVarint(buffer, pos);
		pos = length.pos;
		const end = pos + length.value;
		if (end > buffer.length) {
			throw new Error('帧头字段越界');
		}
		const text = buffer.subarray(pos, end).toString('utf8');
		pos = end;
		if (field === HEADER_FIELD.key) {
			header.key = text;
		} else if (field === HEADER_FIELD.value) {
			header.value = text;
		}
	}
	return header;
}

export function decodeFeishuFrame(buffer: Buffer): FeishuFrame {
	const frame: FeishuFrame = {
		seqId: 0,
		logId: 0,
		service: 0,
		method: 0,
		headers: [],
		payloadEncoding: '',
		payloadType: '',
		payload: null,
	};

	let pos = 0;
	while (pos < buffer.length) {
		const tag = readVarint(buffer, pos);
		pos = tag.pos;
		const field = Math.floor(tag.value / 8);
		const wireType = tag.value % 8;

		if (wireType === WIRE_VARINT) {
			const value = readVarint(buffer, pos);
			pos = value.pos;
			const target = VARINT_TARGETS[field];
			if (target) {
				frame[target] = value.value;
			}
			continue;
		}

		if (wireType === WIRE_BYTES) {
			const length = readVarint(buffer, pos);
			pos = length.pos;
			const end = pos + length.value;
			if (end > buffer.length) {
				throw new Error('帧字段越界');
			}
			const slice = buffer.subarray(pos, end);
			pos = end;
			if (field === FRAME_FIELD.headers) {
				frame.headers.push(decodeHeader(slice));
			} else if (field === FRAME_FIELD.payload) {
				frame.payload = slice;
			} else if (field === FRAME_FIELD.payloadEncoding) {
				frame.payloadEncoding = slice.toString('utf8');
			} else if (field === FRAME_FIELD.payloadType) {
				frame.payloadType = slice.toString('utf8');
			}
			continue;
		}

		if (wireType === WIRE_FIXED32) {
			pos += 4;
			continue;
		}
		if (wireType === WIRE_FIXED64) {
			pos += 8;
			continue;
		}
		throw new Error(`帧字段使用了不支持的 wire type：${wireType}`);
	}

	return frame;
}

export function readFeishuHeader(frame: FeishuFrame, key: string): string {
	for (const header of frame.headers) {
		if (header.key === key) {
			return header.value;
		}
	}
	return '';
}
