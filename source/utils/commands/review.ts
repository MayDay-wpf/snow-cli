import {registerCommand, type CommandResult} from '../commandExecutor.js';
import {reviewAgent} from '../../agents/reviewAgent.js';

// Review command handler - review git changes
registerCommand('review', {
	execute: async (args?: string): Promise<CommandResult> => {
		try {
			// Check if git repository exists
			const gitCheck = reviewAgent.checkGitRepository();

			if (!gitCheck.isGitRepo) {
				return {
					success: false,
					message: gitCheck.error || 'Not a git repository',
				};
			}

			// Get git diff
			const gitDiff = reviewAgent.getGitDiff(gitCheck.gitRoot!);

			if (gitDiff === 'No changes detected in the repository.') {
				return {
					success: false,
					message:
						'No changes detected. Please make some changes before running code review.',
				};
			}

			// Parse additional message from args (format: [message])
			let additionalMessage = '';
			if (args) {
				const match = args.match(/\[([^\]]+)\]/);
				if (match && match[1]) {
					additionalMessage = match[1].trim();
				}
			}

			// Generate review prompt
			let reviewPrompt = `You are a senior code reviewer. Please review the following git changes and provide feedback.

**Your task:**
1. Identify potential bugs, security issues, or logic errors
2. Suggest performance optimizations
3. Point out code quality issues (readability, maintainability)
4. Check for best practices violations
5. Highlight any breaking changes or compatibility issues

**Important:**
- DO NOT modify the code yourself
- Focus on finding issues and suggesting improvements
- Ask the user if they want to fix any issues you find
- Be constructive and specific in your feedback
- Prioritize critical issues over minor style preferences`;

			// Add additional message if provided
			if (additionalMessage) {
				reviewPrompt += `

**User's Additional Notes:**
${additionalMessage}`;
			}

			reviewPrompt += `

**Git Changes:**

\`\`\`diff
${gitDiff}
\`\`\`

Please provide your review in a clear, structured format.`;

			// Return success with review action and prompt
			return {
				success: true,
				action: 'review',
				prompt: reviewPrompt,
				message: 'Starting code review...',
			};
		} catch (error) {
			return {
				success: false,
				message:
					error instanceof Error
						? error.message
						: 'Failed to start code review',
			};
		}
	},
});

export default {};
