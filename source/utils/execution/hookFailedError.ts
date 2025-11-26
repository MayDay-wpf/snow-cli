/**
 * Error thrown when a hook fails with exit code 2+
 * This special error should stop the AI conversation and display to user
 */
export class HookFailedError extends Error {
	public readonly hookName: string;
	public readonly exitCode: number;
	public readonly command: string;
	public readonly output: string;

	constructor(
		hookName: string,
		exitCode: number,
		command: string,
		output: string,
	) {
		super(`${hookName} hook failed with exit code ${exitCode}`);
		this.name = 'HookFailedError';
		this.hookName = hookName;
		this.exitCode = exitCode;
		this.command = command;
		this.output = output;
	}
}
