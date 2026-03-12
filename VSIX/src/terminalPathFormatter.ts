import {ShellType} from './ptyManager';

type TerminalPathFormatOptions = {
	shellType?: ShellType;
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
	const quote =
		platform === 'win32'
			? options.shellType === 'cmd'
				? quoteForCmd
				: quoteForPowerShell
			: quoteForBash;
	return paths.map(quote).join(' ');
}
