import {promises as fs} from 'fs';
import * as chardet from 'chardet';
import * as iconv from 'iconv-lite';

/**
 * Detect file encoding and read content with proper encoding
 * @param filePath - Full path to the file
 * @returns Decoded file content as string
 */
export async function readFileWithEncoding(filePath: string): Promise<string> {
	try {
		// Read file as buffer first
		const buffer = await fs.readFile(filePath);

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
		// Fallback to UTF-8 if encoding detection fails
		console.warn(
			`Encoding detection failed for ${filePath}, using UTF-8:`,
			error,
		);
		return await fs.readFile(filePath, 'utf-8');
	}
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
