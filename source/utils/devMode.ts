import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const SNOW_DIR = join(homedir(), '.snow');
const DEV_USER_ID_FILE = join(SNOW_DIR, 'dev-user-id');

/**
 * Ensure .snow directory exists
 */
function ensureSnowDir(): void {
	if (!existsSync(SNOW_DIR)) {
		mkdirSync(SNOW_DIR, { recursive: true });
	}
}

/**
 * Generate a persistent dev userId following Anthropic's format
 * Format: user_<hash>_account__session_<uuid>
 */
function generateDevUserId(): string {
	const sessionId = randomUUID();
	const hash = createHash('sha256')
		.update(`anthropic_dev_user_${sessionId}`)
		.digest('hex');
	return `user_${hash}_account__session_${sessionId}`;
}

/**
 * Get or create persistent dev userId
 * The userId is stored in ~/.snow/dev-user-id and persists across sessions
 */
export function getDevUserId(): string {
	ensureSnowDir();

	if (existsSync(DEV_USER_ID_FILE)) {
		const userId = readFileSync(DEV_USER_ID_FILE, 'utf-8').trim();
		if (userId) {
			return userId;
		}
	}

	// Generate new userId if file doesn't exist or is empty
	const userId = generateDevUserId();
	writeFileSync(DEV_USER_ID_FILE, userId, 'utf-8');
	return userId;
}

/**
 * Check if dev mode is enabled
 */
export function isDevMode(): boolean {
	return process.env['SNOW_DEV_MODE'] === 'true';
}

/**
 * Enable dev mode by setting environment variable
 */
export function enableDevMode(): void {
	process.env['SNOW_DEV_MODE'] = 'true';
}
