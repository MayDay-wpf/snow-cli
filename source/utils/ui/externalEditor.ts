import {spawn} from 'child_process';
import {promises as fs} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {readFileWithEncoding} from '../../mcp/utils/filesystem/encoding.utils.js';

type StdinLike = NodeJS.ReadStream & {
	isRaw?: boolean;
	setRawMode?: (mode: boolean) => void;
};

function pauseStdinForExternalEditor(): () => void {
	if (!process.stdin.isTTY) {
		return () => {};
	}

	const stdin = process.stdin as StdinLike;

	// stdin.isRaw 在 TTY 下可用；用于更安全地恢复状态。
	const wasRaw = typeof stdin.isRaw === 'boolean' ? stdin.isRaw : undefined;

	stdin.pause();

	return () => {
		stdin.resume();

		if (typeof stdin.setRawMode === 'function') {
			try {
				stdin.setRawMode(wasRaw ?? true);
			} catch {
				// 恢复 raw mode 失败时不应影响主流程
			}
		}
	};
}

function addUtf8Bom(text: string): string {
	// 为增强 Notepad 的编码识别稳定性，写入 UTF-8 BOM。
	return text.startsWith('\uFEFF') ? text : `\uFEFF${text}`;
}

async function spawnNotepad(filePath: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn('notepad.exe', [filePath], {
			stdio: 'inherit',
		});

		child.on('error', reject);
		child.on('close', () => resolve());
	});
}

/**
 * 外部编辑器工具：使用 Windows 记事本（notepad.exe）编辑临时文件，并返回编辑后的文本。
 *
 * 说明：
 * - 该工具仅在 win32 平台生效；其他平台直接返回原始文本（安全降级）。
 * - 为避免 Ink 在编辑期间接收键盘输入，会临时 pause stdin；编辑器退出后恢复并重置 raw mode。
 * - Notepad 可能保存为 UTF-8/UTF-16 等编码；读取时复用 readFileWithEncoding 兼容处理。
 */
export async function editTextWithNotepad(initialText: string): Promise<string> {
	if (process.platform !== 'win32') {
		return initialText;
	}

	const tempFile = join(
		tmpdir(),
		`snow-chat-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
	);

	await fs.writeFile(tempFile, addUtf8Bom(initialText), 'utf8');

	const restoreStdin = pauseStdinForExternalEditor();

	try {
		await spawnNotepad(tempFile);
		const edited = await readFileWithEncoding(tempFile);
		return edited.replace(/^\uFEFF/, '');
	} finally {
		restoreStdin();

		try {
			await fs.unlink(tempFile);
		} catch {
			// 临时文件清理失败不应阻断主流程
		}
	}
}
