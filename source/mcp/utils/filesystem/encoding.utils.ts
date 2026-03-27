import {promises as fs, createReadStream} from 'fs';
import {createInterface} from 'readline';
import * as chardet from 'chardet';
import * as iconv from 'iconv-lite';

// Node.js max string length is 2^29 - 24 ≈ 512MB chars.
// Use 256MB as safe limit to account for encoding expansion overhead.
const MAX_READABLE_FILE_BYTES = 256 * 1024 * 1024;

// Only read a small sample for encoding detection on large files
const ENCODING_SAMPLE_BYTES = 64 * 1024;

function isUtf8Buffer(buffer: Buffer): boolean {
	// UTF-8 BOM
	if (
		buffer.length >= 3 &&
		buffer[0] === 0xef &&
		buffer[1] === 0xbb &&
		buffer[2] === 0xbf
	) {
		return true;
	}

	try {
		// Use a fatal decoder to validate UTF-8 bytes
		const decoder = new TextDecoder('utf-8', {fatal: true});
		decoder.decode(buffer);
		return true;
	} catch {
		return false;
	}
}

/**
 * Detect file encoding and read content with proper encoding.
 * Rejects files larger than ~256MB to avoid Node.js string length limits.
 * @param filePath - Full path to the file
 * @returns Decoded file content as string
 */
export async function readFileWithEncoding(filePath: string): Promise<string> {
	const stats = await fs.stat(filePath);
	if (stats.size > MAX_READABLE_FILE_BYTES) {
		throw new Error(
			`File too large to read as text (${Math.round(stats.size / 1024 / 1024)}MB, limit ${Math.round(MAX_READABLE_FILE_BYTES / 1024 / 1024)}MB): ${filePath}`,
		);
	}

	try {
		// Read file as buffer first
		const buffer = await fs.readFile(filePath);

		// Always prefer valid UTF-8 to avoid mis-detection
		if (isUtf8Buffer(buffer)) {
			return buffer.toString('utf-8');
		}

		// Detect encoding
		const detectedEncoding = chardet.detect(buffer);

		// If no encoding detected or it's already UTF-8, return as UTF-8
		if (
			!detectedEncoding ||
			detectedEncoding === 'UTF-8' ||
			detectedEncoding === 'ascii'
		) {
			return buffer.toString('utf-8');
		}

		// Convert from detected encoding to UTF-8
		// Handle common encoding aliases
		let encoding = detectedEncoding;
		if (encoding === 'GB2312' || encoding === 'GBK' || encoding === 'GB18030') {
			// GB18030 is a superset of GBK and GB2312, use it for better compatibility
			encoding = 'GB18030';
		}

		// Check if encoding is supported
		if (!iconv.encodingExists(encoding)) {
			console.warn(
				`Unsupported encoding detected: ${encoding}, falling back to UTF-8`,
			);
			return buffer.toString('utf-8');
		}

		// Decode with detected encoding
		const decoded = iconv.decode(buffer, encoding);
		return decoded;
	} catch (error) {
		if (
			error instanceof Error &&
			(error as NodeJS.ErrnoException).code === 'ERR_STRING_TOO_LONG'
		) {
			throw new Error(
				`File too large to convert to string: ${filePath} (${Math.round(stats.size / 1024 / 1024)}MB)`,
			);
		}

		// Fallback to UTF-8 if encoding detection fails
		console.warn(
			`Encoding detection failed for ${filePath}, using UTF-8:`,
			error,
		);
		return await fs.readFile(filePath, 'utf-8');
	}
}

/**
 * Read specific line range from a large file via streaming.
 * Works for files of any size since it never loads the entire content into memory.
 * Uses encoding detection on a small sample for non-UTF-8 files.
 * @param filePath - Full path to the file
 * @param startLine - 1-indexed inclusive start line (default: 1)
 * @param endLine - 1-indexed inclusive end line (default: Infinity = until EOF)
 * @returns Object with extracted lines array and total line count
 */
export async function readFileLinesStreaming(
	filePath: string,
	startLine: number = 1,
	endLine: number = Infinity,
): Promise<{lines: string[]; totalLines: number}> {
	// Detect encoding from a small sample
	let encoding = 'utf-8';
	try {
		const fd = await fs.open(filePath, 'r');
		try {
			const sample = Buffer.alloc(ENCODING_SAMPLE_BYTES);
			const {bytesRead} = await fd.read(sample, 0, ENCODING_SAMPLE_BYTES, 0);
			const buf = sample.subarray(0, bytesRead);
			if (!isUtf8Buffer(buf)) {
				const detected = chardet.detect(buf);
				if (
					detected &&
					detected !== 'UTF-8' &&
					detected !== 'ascii' &&
					iconv.encodingExists(detected)
				) {
					encoding = detected;
					if (
						encoding === 'GB2312' ||
						encoding === 'GBK' ||
						encoding === 'GB18030'
					) {
						encoding = 'GB18030';
					}
				}
			}
		} finally {
			await fd.close();
		}
	} catch {
		// Fallback to UTF-8
	}

	const result: string[] = [];
	let lineNumber = 0;

	return new Promise((resolve, reject) => {
		const stream = createReadStream(filePath);
		const input =
			encoding !== 'utf-8' ? stream.pipe(iconv.decodeStream(encoding)) : stream;

		const rl = createInterface({input, crlfDelay: Infinity});

		rl.on('line', (line: string) => {
			lineNumber++;
			if (lineNumber >= startLine && lineNumber <= endLine) {
				result.push(line);
			}
			if (lineNumber > endLine && endLine !== Infinity) {
				rl.close();
			}
		});

		rl.on('close', () => {
			stream.destroy();
			resolve({lines: result, totalLines: lineNumber});
		});

		rl.on('error', err => {
			stream.destroy();
			reject(err);
		});

		stream.on('error', err => {
			rl.close();
			reject(err);
		});
	});
}

/**
 * Write file content with proper encoding detection
 * If the file exists, preserve its original encoding
 * If it's a new file, use UTF-8
 * @param filePath - Full path to the file
 * @param content - Content to write
 */
export async function writeFileWithEncoding(
	filePath: string,
	content: string,
): Promise<void> {
	try {
		// Check if file exists to determine encoding
		let targetEncoding = 'utf-8';

		try {
			const existingBuffer = await fs.readFile(filePath);
			if (isUtf8Buffer(existingBuffer)) {
				targetEncoding = 'utf-8';
			} else {
				const detectedEncoding = chardet.detect(existingBuffer);

				// If file exists with non-UTF-8 encoding, preserve it
				if (
					detectedEncoding &&
					detectedEncoding !== 'UTF-8' &&
					detectedEncoding !== 'ascii'
				) {
					let encoding = detectedEncoding;
					if (
						encoding === 'GB2312' ||
						encoding === 'GBK' ||
						encoding === 'GB18030'
					) {
						// GB18030 is a superset of GBK and GB2312, use it for better compatibility
						encoding = 'GB18030';
					}

					if (iconv.encodingExists(encoding)) {
						targetEncoding = encoding;
					}
				}
			}
		} catch {
			// File doesn't exist, use UTF-8 for new files
		}

		// Write with target encoding
		if (targetEncoding === 'utf-8') {
			await fs.writeFile(filePath, content, 'utf-8');
		} else {
			const encoded = iconv.encode(content, targetEncoding);
			await fs.writeFile(filePath, encoded);
		}
	} catch (error) {
		// Fallback to UTF-8 if encoding handling fails
		console.warn(
			`Encoding handling failed for ${filePath}, using UTF-8:`,
			error,
		);
		await fs.writeFile(filePath, content, 'utf-8');
	}
}
