import {registerCommand, type CommandResult} from '../execution/commandExecutor.js';

function normalizeOneLineText(text: string): string {
	return text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildGitPrPrompt(titleHint?: string): string {
	const normalizedTitleHint = titleHint ? normalizeOneLineText(titleHint) : '';
	const titleHintSection = normalizedTitleHint
		? `用户给出的标题/备注（优先用于 PR 标题）：${normalizedTitleHint}\n\n`
		: '';

	return `${titleHintSection}你是 Snow CLI 的 Git PR 助手。目标：将当前仓库的变更提交到当前分支并创建 GitHub PR，用于向上游仓库合并。

硬性约束（必须遵守）：
1) 为避免 PR 描述换行被转义为字面量 \"\\n\"，必须使用：gh pr create --body-file <path>（禁止使用 --body \"...\\n...\" 形式）。
2) 默认不要提交 helloagents/（本地知识库）、.snow/ 等本地目录，除非用户明确要求。
3) 遇到敏感命令（如 git push）如需确认，请停下来询问用户确认后再继续。

请按以下步骤执行（可根据实际情况微调，但不要违反约束）：

A. 仓库与分支
- 确认当前目录是 Git 仓库：git rev-parse --is-inside-work-tree
- 获取当前分支：git branch --show-current
- 查看工作区/暂存区：git status --porcelain
- 如果当前在 main/master 等主分支上，请创建并切换到新分支（示例：feat/git-pr-command-<YYYYMMDDHHMM>）

B. 暂存与提交（默认仅提交功能相关文件）
- 优先只添加与功能相关的路径（例如本项目通常为：git add source docs）
- 再次确认暂存区不包含 helloagents/、.snow/ 等本地目录（git diff --cached --name-only）
- 生成提交标题：
  - 若用户给了标题提示，用它作为标题
  - 否则从变更内容/分支名/最近提交自动生成一个简短标题
- 提交：git commit -m \"<title>\"

C. 推送
- 推送到 fork（通常 remote=origin）：git push -u origin <branch>

D. 生成 PR 描述文件（真实换行）
- 生成临时文件路径（建议放到系统临时目录或项目内临时文件夹，例如 .snow/pr-body.md）
- 用真实换行写入 PR 描述文件：
  - 先写入最近一次提交信息：git log -1 --pretty=%B > \"<bodyFile>\"
  - 再追加变更统计（选择合适的 baseRef，优先 upstream/main，其次 origin/main）：git diff --stat <baseRef>...HEAD >> \"<bodyFile>\"

E. 创建 PR（指向上游仓库）
- 获取 headRepo（当前仓库）：gh repo view --json nameWithOwner --jq .nameWithOwner
- 获取 baseRepo（上游仓库）：
  - 若当前仓库是 fork：gh repo view --json parent --jq .parent.nameWithOwner
  - 若没有 parent（非 fork）：baseRepo = headRepo
- 使用 body-file 创建 PR：
  - gh pr create --repo \"<baseRepo>\" --base main --head \"<headOwner>:<branch>\" --title \"<title>\" --body-file \"<bodyFile>\"
- 输出 PR URL。

F. 清理
- 删除临时 PR 描述文件。
`;
}

function buildUsage(): CommandResult {
	return {
		success: true,
		message:
			'Usage:\n  /git pr [title]\n\nExample:\n  /git pr Add /git pr slash command',
	};
}

registerCommand('git', {
	execute: (args?: string): CommandResult => {
		const rawArgs = args?.trim() ?? '';
		if (!rawArgs || rawArgs === '-h' || rawArgs === '--help') {
			return buildUsage();
		}

		const [subcommand, ...rest] = rawArgs.split(/\s+/);
		if (subcommand !== 'pr') {
			return buildUsage();
		}

		const titleHint = rest.join(' ').trim();

		return {
			success: true,
			action: 'executeCustomCommand',
			message: 'Preparing PR creation prompt…',
			prompt: buildGitPrPrompt(titleHint),
		};
	},
});

export default {};
