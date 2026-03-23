import {ShellFamily} from './ptyManager';

type TerminalPathFormatOptions = {
	shellFamily?: ShellFamily;
	platform?: NodeJS.Platform;
};

function quoteForPowerShell(path: string): string {
	return `'${path.replace(/'/g, "''")}'`;
}

function quoteForCmd(path: string): string {
	return `"${path.replace(/[%!]/g, '^$&')}"`;
}

function quoteForBash(path: string): string {
	return `'${path.replace(/'/g, `"'"'`)}'`;
}

export function formatTerminalPathPayload(
	paths: readonly string[],
	options: TerminalPathFormatOptions = {},
): string {
	const platform = options.platform ?? process.platform;
	const family = options.shellFamily ?? (platform === 'win32' ? 'powershell' : 'posix');
	const quote =
		family === 'cmd'
			? quoteForCmd
			: family === 'powershell'
				? quoteForPowerShell
				: quoteForBash;
	return paths.map(quote).join(' ');
}
