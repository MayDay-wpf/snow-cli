---
name: snow-docs
description: "Use when the user asks to install, configure, troubleshoot, or understand Snow CLI itself — Profile/API setup, MCP servers, Skills, Hooks, sub-agents, sensitive commands, proxy/browser, third-party relay, LSP/ACE, Team mode, SSE, privacy, plugins, or docs paths. Loads official bundled usage docs via progressive disclosure (list/search/get) instead of guessing from model memory."
allowed-tools: snow-docs-list, snow-docs-search, snow-docs-get, filesystem-read, askuser-ask_question
---

# snow-docs

Authoritative **Snow CLI usage documentation** skill (bundled with the CLI version).

## When to use

Trigger for any request about **Snow itself**, for example:

- First-time setup / Profile / API / model selection
- MCP install/config/enable/disable / troubleshooting
- Skills (`~/.snow/skills`, `.snow/skills`, `skill-execute`)
- Hooks, sub-agents, sensitive commands, YOLO
- Proxy / browser / third-party relay / custom headers
- LSP, Team mode, SSE, StatusLine, privacy, plugins, games

Do **not** use this skill for general coding in an unrelated project unless the user is configuring Snow.

## Progressive disclosure workflow

1. **Discover** with `snow-docs-list` (catalogue only) or `snow-docs-search` (keywords).
2. **Read one topic** with `snow-docs-get` using an id from search/list (e.g. `14.MCP配置.md`).
3. **Then** inspect/edit local config files only as the docs specify.
4. Prefer **bundled docs** over model memory or random GitHub raw URLs.

Never load all documents in one turn. Never dump the entire manual into context.

## Authoritative config locations (confirm via docs)

Common paths (always re-check the fetched doc for the current version):

- `~/.snowcli/` — global CLI config / profiles
- `~/.snow/` — global skills, todos, etc.
- `<project>/.snow/settings.json` — project settings (`disabledSkills`, `disabledBuiltInServices`, ...)
- `<project>/.snow/skills` / `~/.snow/skills` — user skills

## Safety rules

- Tools are **read-only** for docs. Writing config still goes through normal file/UI flows.
- Confirm high-risk changes with the user (API keys, disabling security, sensitive command rules).
- Do not silently rewrite global config.
- Disable path: users can disable the `snow-docs` skill (`disabledSkills`) or the `snow-docs` built-in service (`disabledBuiltInServices`).

## Locale

Docs tools follow the user Language Settings (`zh` / `zh-TW` → Chinese docs, otherwise English). Pass `locale: "zh" | "en"` only when the user asks for a specific language.

## Quick map

| Topic | Search hints |
| --- | --- |
| Install / update | install, 安装 |
| First config / Profile | profile, 首次配置, api |
| MCP | mcp, tools |
| Skills | skills, skill-execute |
| Hooks | hooks |
| Sub-agents | subagent, 子代理 |
| Sensitive commands | sensitive, 敏感命令 |
| Relay / headers | relay, 中转 |
| LSP / ACE | lsp, ace |
| Team / SSE / privacy | team, sse, privacy |

After loading this skill, start with `snow-docs-search` or `snow-docs-list` for the user's topic.
