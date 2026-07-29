import type {TokenUsage} from '../../utils/execution/subAgentTypes.js';
import {formatTokens} from './formatTokens.js';

export function formatSubAgentFinalUsage(usage: TokenUsage): string {
	const inputTokens =
		usage.inputTokens +
		(usage.cacheCreationInputTokens ?? 0) +
		(usage.cacheReadInputTokens ?? 0);
	const totalTokens = inputTokens + usage.outputTokens;

	return `${formatTokens(totalTokens)} tokens (In ${formatTokens(
		inputTokens,
	)} / Out ${formatTokens(usage.outputTokens)})`;
}
