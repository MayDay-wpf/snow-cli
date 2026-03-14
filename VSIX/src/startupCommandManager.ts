const DEFAULT_STARTUP_COMMAND = 'snow';

function normalizeStartupCommand(command: string): string | undefined {
	const trimmed = command.trim();
	return trimmed ? trimmed : undefined;
}

function parseStartupCommands(rawConfig: string | undefined): string[] {
	if (typeof rawConfig !== 'string') {
		return [DEFAULT_STARTUP_COMMAND];
	}

	return rawConfig
		.split(',')
		.map(normalizeStartupCommand)
		.filter((command): command is string => Boolean(command));
}

class StartupCommandManager {
	private commands: string[] = [DEFAULT_STARTUP_COMMAND];
	private nextCommandIndex = 0;

	public setStartupCommandConfig(rawConfig: string | undefined): void {
		this.commands = parseStartupCommands(rawConfig);
		this.nextCommandIndex = 0;
	}

	public getNextStartupCommand(): string | undefined {
		if (this.commands.length === 0) {
			return undefined;
		}

		const command = this.commands[this.nextCommandIndex];
		this.nextCommandIndex =
			(this.nextCommandIndex + 1) % this.commands.length;
		return command;
	}
}

export const startupCommandManager = new StartupCommandManager();
