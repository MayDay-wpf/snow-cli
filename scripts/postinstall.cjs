#!/usr/bin/env node

/**
 * Post-install script to provide installation optimization tips for users
 */

const https = require('https');
const { execSync } = require('child_process');

// ANSI color codes
const colors = {
	reset: '\x1b[0m',
	bright: '\x1b[1m',
	cyan: '\x1b[36m',
	yellow: '\x1b[33m',
	green: '\x1b[32m',
};

/**
 * Detect if user is in China based on IP geolocation
 */
function detectRegion() {
	return new Promise((resolve) => {
		const timeout = setTimeout(() => resolve('unknown'), 3000);

		https.get('https://ipapi.co/json/', (res) => {
			let data = '';
			res.on('data', (chunk) => data += chunk);
			res.on('end', () => {
				clearTimeout(timeout);
				try {
					const info = JSON.parse(data);
					resolve(info.country_code === 'CN' ? 'china' : 'other');
				} catch {
					resolve('unknown');
				}
			});
		}).on('error', () => {
			clearTimeout(timeout);
			resolve('unknown');
		});
	});
}

/**
 * Check current npm registry
 */
function getCurrentRegistry() {
	try {
		const registry = execSync('npm config get registry', { encoding: 'utf8' }).trim();
		return registry;
	} catch {
		return 'https://registry.npmjs.org';
	}
}

/**
 * Main function
 */
async function main() {
	// Skip if running in CI environment
	if (process.env.CI || process.env.CONTINUOUS_INTEGRATION) {
		return;
	}

	const currentRegistry = getCurrentRegistry();
	const isUsingMirror = currentRegistry.includes('npmmirror.com') ||
	                      currentRegistry.includes('taobao.org');

	// If already using a mirror, skip the tips
	if (isUsingMirror) {
		return;
	}

	console.log(`\n${colors.cyan}${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
	console.log(`${colors.cyan}${colors.bright}  Snow AI - Installation Optimization Tips${colors.reset}`);
	console.log(`${colors.cyan}${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

	const region = await detectRegion();

	if (region === 'china') {
		console.log(`${colors.yellow}检测到您在中国大陆地区,建议配置 npm 镜像源以加速安装:${colors.reset}\n`);
		console.log(`${colors.green}# 方案 1: 使用淘宝镜像 (推荐)${colors.reset}`);
		console.log(`  npm config set registry https://registry.npmmirror.com\n`);
		console.log(`${colors.green}# 方案 2: 临时使用镜像安装${colors.reset}`);
		console.log(`  npm install -g snow-ai --registry=https://registry.npmmirror.com\n`);
		console.log(`${colors.green}# 恢复官方源${colors.reset}`);
		console.log(`  npm config set registry https://registry.npmjs.org\n`);
	} else {
		console.log(`${colors.yellow}To speed up npm installation, you can:${colors.reset}\n`);
		console.log(`${colors.green}# Enable parallel downloads${colors.reset}`);
		console.log(`  npm config set maxsockets 10\n`);
		console.log(`${colors.green}# Use offline cache when possible${colors.reset}`);
		console.log(`  npm config set prefer-offline true\n`);
		console.log(`${colors.green}# Skip unnecessary checks${colors.reset}`);
		console.log(`  npm config set audit false\n`);
		console.log(`  npm config set fund false\n`);
	}

	console.log(`${colors.cyan}Current registry: ${currentRegistry}${colors.reset}`);
	console.log(`${colors.cyan}${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);
}

main().catch(() => {
	// Silently fail - don't break installation
});
