# Repository Guidelines

## 请一直使用中文交互

## Project Structure & Module Organization

- Source TypeScript lives in `source/`, grouped by concern: `api/` for OpenAI and MCP bindings, `ui/` for Ink components/pages, `utils/` for configuration, session, and command helpers, and `hooks/` for shared stateful logic. Entry points are `source/app.tsx` and `source/cli.tsx`.
- Tests reside in `source/test/` alongside subject modules; build artifacts land in `dist/` via `tsc` and expose the published CLI (`dist/cli.js`).
- User-specific settings are written to the home directory under `.snow/` by the helpers in `source/utils/apiConfig.ts`.

## Build, Test, and Development Commands

- `npm install` installs dependencies (requires Node 16+).
- `npm run dev` compiles the TypeScript sources in watch mode for iterative work.
- `npm run build` performs a one-shot TypeScript build to refresh `dist/`.
- `npm start` runs the compiled CLI (`node dist/cli.js`); append `--help` to inspect available flags.
- `npm test` executes the full quality gate: Prettier formatting check, XO lint, and the AVA test suite.

## Coding Style & Naming Conventions

- Project-wide settings in `.editorconfig` enforce tabs for code, LF line endings, UTF-8, and trailing newline. YAML files use two-space indentation.
- Adopt TypeScript + React best practices: PascalCase for Ink components (`SnowHeader.tsx`), camelCase for helpers (`loadConfig`), and `SCREAMING_SNAKE_CASE` for constants in `source/constants`.
- Keep imports sorted by module type, prefer named exports, and let XO and Prettier dictate formatting (`npm run format`).

## Testing Guidelines

- Write AVA specs next to the unit under `source/test/`, naming files `*-test.ts` to align with the existing `logger-test.ts` pattern.
- Use dependency injection to mock external services (e.g., OpenAI API) and cover CLI behavior via the Ink testing library.
- Run `npm test` before pushing; target meaningful assertions over raw coverage metrics as the suite gates CI.

## Commit & Pull Request Guidelines

- Follow Conventional Commits (`feat:`, `fix(scope):`, `refactor:`). Recent history mixes English and Chinese descriptions; prefer concise English summaries when possible.
- Group logically related changes per commit, reference issue IDs in the body when applicable, and capture breaking changes under a `BREAKING CHANGE:` footer.
- Pull requests should describe the user-facing impact, list verification commands (`npm test`), and attach terminal screenshots or recordings when altering interactive flows.

## Configuration & Security Notes

- Never commit files from the generated `.snow/` config directory; redact API keys in examples.
- Document new environment variables in `readme.md` and ensure defaults degrade gracefully when unset.
