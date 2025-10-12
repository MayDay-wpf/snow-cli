import { useEffect } from 'react';
import { useApp } from 'ink';
import { spawn } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';

type Props = {
	onBack: () => void;
	onSave: () => void;
};

const CONFIG_DIR = join(homedir(), '.snow');
const CUSTOM_HEADERS_FILE = join(CONFIG_DIR, 'custom-headers.json');

function getSystemEditor(): string {
	if (platform() === 'win32') {
		return 'notepad';
	}
	return process.env['EDITOR'] || 'vim';
}

function ensureConfigDirectory(): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true });
	}
}

const DEFAULT_HEADERS_TEMPLATE = `{
  "X-Custom-Header": "custom-value",
  "User-Agent": "MyApp/1.0"
}`;

export default function CustomHeadersScreen({ onBack }: Props) {
	const { exit } = useApp();

	useEffect(() => {
		const openEditor = async () => {
			ensureConfigDirectory();

			// Read existing custom headers, or use template if not exists
			let currentHeaders = DEFAULT_HEADERS_TEMPLATE;
			if (existsSync(CUSTOM_HEADERS_FILE)) {
				try {
					currentHeaders = readFileSync(CUSTOM_HEADERS_FILE, 'utf8');
				} catch {
					// Read failed, use template
					currentHeaders = DEFAULT_HEADERS_TEMPLATE;
				}
			}

			// Write to file for editing
			writeFileSync(CUSTOM_HEADERS_FILE, currentHeaders, 'utf8');

			const editor = getSystemEditor();

			exit();

			const child = spawn(editor, [CUSTOM_HEADERS_FILE], {
				stdio: 'inherit'
			});

			child.on('close', () => {
				// Read edited content
				if (existsSync(CUSTOM_HEADERS_FILE)) {
					try {
						const editedContent = readFileSync(CUSTOM_HEADERS_FILE, 'utf8');
						const trimmedContent = editedContent.trim();

						// Validate JSON format
						if (trimmedContent === '' || trimmedContent === '{}') {
							// Empty or empty object, delete file to reset
							try {
								const fs = require('fs');
								fs.unlinkSync(CUSTOM_HEADERS_FILE);
								console.log('Custom headers cleared. Please use `snow` to restart!');
							} catch {
								// Delete failed, save empty object
								writeFileSync(CUSTOM_HEADERS_FILE, '{}', 'utf8');
								console.log('Custom headers cleared. Please use `snow` to restart!');
							}
						} else {
							// Validate JSON
							try {
								const headers = JSON.parse(trimmedContent);
								if (typeof headers !== 'object' || headers === null || Array.isArray(headers)) {
									throw new Error('Headers must be a JSON object');
								}

								// Validate all values are strings
								for (const [key, value] of Object.entries(headers)) {
									if (typeof value !== 'string') {
										throw new Error(`Header value for "${key}" must be a string`);
									}
								}

								// Save valid headers
								writeFileSync(CUSTOM_HEADERS_FILE, JSON.stringify(headers, null, 2), 'utf8');
								console.log('Custom headers saved successfully! Please use `snow` to restart!');
							} catch (error) {
								console.error('Invalid JSON format:', error instanceof Error ? error.message : 'Unknown error');
								console.error('Custom headers were NOT saved. Please fix the JSON format and try again.');
							}
						}
					} catch (error) {
						console.error('Failed to save custom headers:', error instanceof Error ? error.message : 'Unknown error');
					}
				}

				process.exit(0);
			});

			child.on('error', (error) => {
				console.error('Failed to open editor:', error.message);
				process.exit(1);
			});
		};

		openEditor();
	}, [exit, onBack]);

	return null;
}
