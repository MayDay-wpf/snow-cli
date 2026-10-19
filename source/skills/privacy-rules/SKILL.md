---
name: privacy-rules
description: 'Use when the user wants Snow CLI to redact / mask / desensitize something specific in tool results (order numbers, employee ids, internal hostnames, customer codes, tokens with a custom format, etc.) or asks to create, edit, test, enable/disable, or delete privacy custom rules (隐私脱敏自定义规则). Drafts a regex rule, dry-runs it on sample text, confirms with the user, then saves it through the session-command privacy-rules commands.'
allowed-tools: session-command-list, session-command-run, askuser-ask_question, filesystem-read
---

# privacy-rules

Help the user author **privacy custom masking rules** for Snow CLI. Rules live in
`privacy.customRules` of `<project>/.snow/settings.json` (scope `project`) or
`~/.snow/settings.json` (scope `global`) and are applied to selected tool results
in both Local Rules mode and Online API mode.

## Commands (via `session-command-run`)

| Goal                 | command                | args                                                                                                                              | confirm |
| -------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------- |
| List rules           | `privacy-rules.list`   | `--scope=project` / `--scope=global` (optional)                                                                                   | no      |
| Dry-run a rule       | `privacy-rules.test`   | JSON `{"sample":"...","pattern":"...","group":0,"replacement":"","withBuiltinRules":false}` or `{"sample":"...","id":"<ruleId>"}` | no      |
| Add / update         | `privacy-rules.upsert` | `[--scope=global] <rule object or array>`                                                                                         | **yes** |
| Replace all          | `privacy-rules.set`    | `[--scope=global] <rule array>`                                                                                                   | **yes** |
| Delete               | `privacy-rules.remove` | `[--scope=global] <idOrName ...>` or JSON string array                                                                            | **yes** |
| Check privacy switch | `privacy`              | `status`                                                                                                                          | no      |

`args` is passed through verbatim, so put raw JSON directly in it (no extra quoting).
Scope defaults to `project`. Project rules, when defined, fully override global ones.

## Rule format

```json
{
	"id": "optional, generated when omitted",
	"name": "required, short human label",
	"pattern": "required JavaScript regex",
	"group": 0,
	"replacement": "",
	"enabled": true
}
```

- `pattern`: JavaScript regex syntax. A leading `(?i)` / `(?m)` / `(?s)` flag and
  `(?P<name>...)` named groups are also accepted (Snow App compatible). Do not use
  `(?x)` or inline flags in the middle of the pattern.
- `group`: capture group to mask; `0` masks the whole match. Use a group to keep the
  key and mask only the value, e.g. `order[-_ ]?no[:=]\s*(\w+)` with `group: 1`.
- `replacement`: literal text such as `[ORDER]`; empty masks every character with `*`.
- `upsert` matches an existing rule by `id`, then by `name`, and keeps omitted fields.
- Limits: name up to 120 chars, pattern up to 2000 chars, at most 200 rules per scope.
- Remember JSON escaping: the regex `\d+` is written as `"\\d+"` inside JSON.

## Workflow

1. **Clarify** what must be hidden. Ask for 1-3 realistic sample lines (fake values are fine)
   and whether the key/prefix should stay visible. Use `askuser-ask_question` when the
   target format is ambiguous.
2. **Inspect** current state: `privacy-rules.list` (and `privacy` `status` to see whether
   privacy filtering is enabled at all).
3. **Draft** the narrowest regex that matches the samples. Prefer anchoring on stable
   prefixes/keys and word boundaries over broad character classes.
4. **Dry-run** with `privacy-rules.test` on every sample, plus at least one negative sample
   that must NOT match. Iterate until `matches` is exactly what the user wants. Use
   `withBuiltinRules: true` to see the combined result with built-in rules.
5. **Confirm** with the user: show the final rule JSON, the scope, and the masked preview.
6. **Save** with `privacy-rules.upsert` and `confirm: true`. Re-run `privacy-rules.list`
   to verify.
7. **Remind** the user: rules only apply when privacy filtering is enabled and the tool is
   selected in Privacy Settings -> Tool Results (defaults: `filesystem-read`, `ace-search`,
   `terminal-execute`). Enabling privacy is `privacy on` (also needs confirm).

## Examples

Mask employee ids such as `EMP-1234`:

```json
{"name": "Employee id", "pattern": "\\bEMP-\\d{4,6}\\b"}
```

Keep the key, replace only the order number:

```json
{
	"name": "Order number",
	"pattern": "(?i)order[-_ ]?no[:=]\\s*(\\w+)",
	"group": 1,
	"replacement": "[ORDER]"
}
```

Mask internal hostnames under `corp.example.com`:

```json
{
	"name": "Internal host",
	"pattern": "\\b[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.corp\\.example\\.com\\b"
}
```

## Safety rules

- Never write without explicit user approval; writes require `confirm: true`.
- Do not paste real secrets into rules or replacements; regexes should describe the
  format, not embed actual sensitive values.
- Avoid catastrophic backtracking (`(a+)+`, `(.*)*`, nested unbounded quantifiers);
  JavaScript regexes are backtracking and run on every masked tool result.
- Prefer `upsert` over `set`; `set` replaces the whole list of that scope.
- Changing `--scope=global` affects every project without project-level rules; ask first.
