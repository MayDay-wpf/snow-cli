import fs from 'node:fs';

const files = [
  ['source/utils/session/sessionManager.ts', 'session:manager'],
  ['source/agents/codebaseIndexAgent.ts', 'agents:codebaseIndex'],
  ['source/utils/execution/mcpToolsManager.ts', 'execution:mcpToolsManager'],
  ['source/mcp/aceCodeSearch.ts', 'mcp:aceCodeSearch'],
  ['source/agents/codebaseReviewAgent.ts', 'agents:codebaseReview'],
  ['source/mcp/codebaseSearch.ts', 'mcp:codebaseSearch'],
  ['source/utils/team/teamWorktree.ts', 'team:worktree'],
  ['source/utils/codebase/hashBasedSnapshot.ts', 'codebase:hashBasedSnapshot'],
  ['source/utils/core/resourceMonitor.ts', 'core:resourceMonitor'],
  ['source/utils/core/globalCleanup.ts', 'core:globalCleanup'],
  ['source/utils/acp/acpManager.ts', 'acp:acpManager'],
  ['source/utils/ui/vscodeConnection.ts', 'ui:vscodeConnection'],
  ['source/agents/summaryAgent.ts', 'agents:summary'],
  ['source/utils/commands/newPrompt.ts', 'commands:newPrompt'],
  ['source/utils/core/processManager.ts', 'core:processManager'],
  ['source/utils/task/goalManager.ts', 'task:goalManager']
];

for (const [filePath, namespace] of files) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes("child('") && !content.includes('child("')) {
    content = content.replace(
      /(import\s*\{[^}]*logger[^}]*\}\s*from\s*['"][^'"]+['"];?)/,
      `$1\n\nconst log = logger.child('${namespace}');`
    );
  }
  // Replace logger.debug/info/warn/error with log.debug/info/warn/error safely using function replacement
  const before = content;
  content = content.replace(/\blogger\.(debug|info|warn|error)\(/g, (_, method) => `log.${method}(`);
  if (content !== before) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Standardized: ${filePath} -> ${namespace}`);
  }
}
