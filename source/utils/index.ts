import {Command} from '../types/index.js';

export function formatCommand(command: Command): string {
	return `${command.name.padEnd(12)} ${command.description}`;
}

export function parseInput(input: string): {command: string; args: string[]} {
	const parts = input.trim().split(' ');
	const command = parts[0] || '';
	const args = parts.slice(1);
	return {command, args};
}

export function sanitizeInput(input: string): string {
	return input.trim().replace(/[<>]/g, '');
}