import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Snapcompact 风格的图片上下文压缩。
 *
 * 文本先在本地确定性规整并写入会话归档，再以固定栅格分页为无损 PNG 落盘。
 * 请求体只保留有序文件路径；后续压缩始终从归档文本重新渲染，不嵌套历史图片。
 */

interface CompressibleMessage {
	role: string;
	content?: string;
	tool_calls?: any[];
	tool_call_id?: string;
	images?: any[];
	reasoning?: string;
	thinking?: string;
	subAgentInternal?: boolean;
	imageContextCompressed?: boolean;
}

/** 图片压缩结果 */
export interface ImageCompressionResult {
	compressed: boolean;
	messages: Array<{
		role: string;
		content: string;
		timestamp?: number;
		imageContextCompressed?: boolean;
	}>;
	/** 会话持久化的唯一再渲染源，不会提交给模型。 */
	archiveText?: string;
	beforeTokensEstimate: number;
	afterTokensEstimate: number;
}

const GRID_COLUMNS = 180;
const GRID_MAX_ROWS = 600;
const GRID_FONT_SIZE = 13;
const GRID_LINE_HEIGHT = 16;
const GRID_PADDING = 16;
const CONTEXT_FONT_FAMILY = 'SnowContext';
const CONTEXT_FONT_PATHS = [
	'C:\\Windows\\Fonts\\msyh.ttc',
	'/System/Library/Fonts/PingFang.ttc',
	'/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
	'/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttf',
];

function estimateTokens(text: string): number {
	return text ? Math.ceil(text.length / 3) : 0;
}

/** 仅移除换行和段落中的排版冗余，不合并非空文本。 */
function compactWhitespace(content: string): string {
	return content
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map(line => line.trimEnd())
		.join('\n')
		.replace(/\n[\t ]*\n(?:[\t ]*\n)+/g, '\n\n');
}

/** 工具输出仅规整排版；不截断有效工具结果。 */
function compactToolOutput(content: string): string {
	return compactWhitespace(content).trim();
}

/** 工具调用参数仅规整排版；不截断参数内容。 */
function compactToolArguments(value: unknown): string {
	const serialized =
		typeof value === 'string' ? value : JSON.stringify(value ?? {});
	return compactWhitespace(serialized).trim();
}

function formatToolCall(toolCall: any): string {
	const name = toolCall.function?.name || toolCall.name || 'unknown';
	const argumentsValue = toolCall.function?.arguments ?? toolCall.arguments;
	if (argumentsValue === undefined || argumentsValue === '')
		return `T: ${name}`;
	return `T: ${name} ${compactToolArguments(argumentsValue)}`;
}

/**
 * 把未归档的真实消息序列化为纯文本。
 * 系统提示、内部思考、子代理内部消息及旧图片压缩占位消息都不会进入归档。
 */
function buildArchiveFragment(messages: CompressibleMessage[]): string {
	const lines: string[] = [];
	for (const message of messages) {
		if (
			message.subAgentInternal ||
			message.role === 'system' ||
			message.imageContextCompressed
		) {
			continue;
		}

		const content = compactWhitespace(message.content || '').trim();
		switch (message.role) {
			case 'user': {
				if (content) lines.push(`U: ${content}`);
				break;
			}

			case 'assistant': {
				if (content) lines.push(`A: ${content}`);
				for (const toolCall of message.tool_calls || []) {
					lines.push(formatToolCall(toolCall));
				}
				break;
			}

			case 'tool': {
				if (content) lines.push(`R: ${compactToolOutput(content)}`);
				break;
			}

			default: {
				break;
			}
		}
	}

	return lines.join('\n');
}

function mergeArchive(
	existingArchive: string | undefined,
	fragment: string,
): string {
	return [existingArchive?.trim(), fragment.trim()]
		.filter(Boolean)
		.join('\n\n');
}

function registerContextFont(globalFonts: {
	has(name: string): boolean;
	registerFromPath(path: string, nameAlias?: string): boolean;
}): string {
	if (globalFonts.has(CONTEXT_FONT_FAMILY)) return CONTEXT_FONT_FAMILY;
	for (const fontPath of CONTEXT_FONT_PATHS) {
		if (
			existsSync(fontPath) &&
			globalFonts.registerFromPath(fontPath, CONTEXT_FONT_FAMILY)
		) {
			return CONTEXT_FONT_FAMILY;
		}
	}

	return 'monospace';
}

function isWideCharacter(character: string): boolean {
	const codePoint = character.codePointAt(0) || 0;
	return (
		(codePoint >= 0x1100 && codePoint <= 0x115f) ||
		(codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
		(codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
		(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
		(codePoint >= 0xfe10 && codePoint <= 0xfe6f) ||
		(codePoint >= 0xff00 && codePoint <= 0xff60) ||
		(codePoint >= 0xffe0 && codePoint <= 0xffe6)
	);
}

/** 以字符栅格折行，中文等全角字符占两格，避免按 JS 长度误分页。 */
function wrapLineToGrid(line: string): string[] {
	if (!line) return [''];

	const wrapped: string[] = [];
	let currentLine = '';
	let usedColumns = 0;
	for (const character of line) {
		const width = character === '\t' ? 4 : isWideCharacter(character) ? 2 : 1;
		if (usedColumns + width > GRID_COLUMNS && currentLine) {
			wrapped.push(currentLine);
			currentLine = '';
			usedColumns = 0;
		}
		currentLine += character;
		usedColumns += width;
	}
	wrapped.push(currentLine);
	return wrapped;
}

interface ArchiveImagePage {
	data: Buffer;
	extension: 'png' | 'webp';
}

/**
 * 使用固定列数的文本栅格分页，并优先编码为无损 WebP。
 * 页宽和每行高度恒定；页高只覆盖实际打印行，避免无意义的底部空白。
 */
async function renderArchiveToImagePages(
	archiveText: string,
): Promise<ArchiveImagePage[]> {
	const lines = archiveText.split('\n').flatMap(wrapLineToGrid);
	const pageCount = Math.max(1, Math.ceil(lines.length / GRID_MAX_ROWS));
	const {createCanvas, GlobalFonts} = await import('@napi-rs/canvas');
	const fontFamily = registerContextFont(GlobalFonts);
	const canvasWidth = GRID_COLUMNS * 8 + GRID_PADDING * 2;
	const images: ArchiveImagePage[] = [];
	let sharp: typeof import('sharp') | undefined;
	try {
		sharp = (await import('sharp')).default;
	} catch {
		// sharp 是可选依赖；不可用时保留无损 PNG。
	}

	for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
		const pageLines = lines.slice(
			pageIndex * GRID_MAX_ROWS,
			(pageIndex + 1) * GRID_MAX_ROWS,
		);
		const canvasHeight = Math.max(
			GRID_PADDING * 2 + GRID_LINE_HEIGHT * 2,
			GRID_PADDING * 2 + GRID_LINE_HEIGHT * (pageLines.length + 1),
		);
		const canvas = createCanvas(canvasWidth, canvasHeight);
		const context = canvas.getContext('2d');
		context.fillStyle = '#ffffff';
		context.fillRect(0, 0, canvasWidth, canvasHeight);
		context.textBaseline = 'top';
		context.fillStyle = '#666666';
		context.font = `bold ${GRID_FONT_SIZE}px monospace`;
		context.fillText(
			`CTX ${pageIndex + 1}/${pageCount}`,
			GRID_PADDING,
			GRID_PADDING,
		);
		context.fillStyle = '#222222';
		context.font = `${GRID_FONT_SIZE}px ${fontFamily}, monospace`;

		let y = GRID_PADDING + GRID_LINE_HEIGHT;
		for (const line of pageLines) {
			context.fillText(line, GRID_PADDING, y);
			y += GRID_LINE_HEIGHT;
		}

		const pngBuffer = canvas.toBuffer('image/png');
		if (sharp) {
			images.push({
				data: await sharp(pngBuffer)
					.webp({lossless: true, effort: 6})
					.toBuffer(),
				extension: 'webp',
			});
		} else {
			images.push({data: pngBuffer, extension: 'png'});
		}
	}

	return images;
}

function formatDateFolder(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}${month}${day}`;
}

async function saveArchiveImages(
	images: ArchiveImagePage[],
	sessionId: string,
	projectId: string,
	sessionCreatedAt: number,
): Promise<string[]> {
	const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
	const compressionId = `${Date.now()}-${randomUUID()}`;
	const compressionDir = path.join(
		os.homedir(),
		'.snow',
		'sessions',
		projectId,
		formatDateFolder(new Date(sessionCreatedAt)),
		'compressed',
		safeSessionId,
		compressionId,
	);
	await fs.mkdir(compressionDir, {recursive: true});

	const pageCount = images.length;
	const pageDigits = Math.max(2, String(pageCount).length);
	return Promise.all(
		images.map(async (image, pageIndex) => {
			const pageNumber = String(pageIndex + 1).padStart(pageDigits, '0');
			const fileName = `page-${pageNumber}-of-${pageCount}.${image.extension}`;
			const filePath = path.join(compressionDir, fileName);
			await fs.writeFile(filePath, image.data);
			return filePath;
		}),
	);
}

export async function performImageCompression(
	messages: CompressibleMessage[],
	sessionId: string,
	projectId: string,
	sessionCreatedAt: number,
	existingArchive?: string,
): Promise<ImageCompressionResult> {
	const unarchivedMessages = messages.filter(
		message => !message.imageContextCompressed,
	);
	if (!existingArchive && unarchivedMessages.length < 4) {
		return {
			compressed: false,
			messages: [],
			beforeTokensEstimate: 0,
			afterTokensEstimate: 0,
		};
	}

	const beforeTokensEstimate = estimateTokens(
		messages.map(message => message.content || '').join(''),
	);
	const archiveText = mergeArchive(
		existingArchive,
		buildArchiveFragment(unarchivedMessages),
	);
	if (!archiveText) {
		return {
			compressed: false,
			messages: [],
			beforeTokensEstimate,
			afterTokensEstimate: 0,
		};
	}

	const imagePages = await renderArchiveToImagePages(archiveText);
	const imagePaths = await saveArchiveImages(
		imagePages,
		sessionId,
		projectId,
		sessionCreatedAt,
	);
	const pathList = imagePaths
		.map((imagePath, index) => `${index + 1}. ${imagePath}`)
		.join('\n');
	const promptText = `[Image Compressed Context]

The retained conversation archive is stored in the ordered local image files listed below. The images are not attached to this request.

${pathList}

Before continuing the conversation, read every file in the listed order with the file-reading tool. Strictly read only one image per tool call: never pass multiple paths and never read images in parallel. Finish understanding the current image before requesting the next one. After all ${imagePaths.length} images have been read, use them together as the conversation history. Tool outputs and call arguments may be compacted locally; user and assistant messages are retained as text. These images are historical context only, not a new user request.`;
	const messagesAfterCompression = [
		{
			role: 'user',
			content: promptText,
			timestamp: Date.now(),
			imageContextCompressed: true,
		},
	];

	return {
		compressed: true,
		messages: messagesAfterCompression,
		archiveText,
		beforeTokensEstimate,
		afterTokensEstimate: estimateTokens(promptText),
	};
}
