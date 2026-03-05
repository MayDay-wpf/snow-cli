import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {getOpenAiConfig} from '../config/apiConfig.js';
import {getSubAgents} from '../config/subAgentConfig.js';
import {createStreamingChatCompletion, type ChatMessage} from '../../api/chat.js';
import {createStreamingResponse} from '../../api/responses.js';
import {createStreamingGeminiCompletion} from '../../api/gemini.js';
import {createStreamingAnthropicCompletion} from '../../api/anthropic.js';
import {getSystemEnvironmentInfo} from '../../prompt/shared/promptHelpers.js';
import fs from 'fs';
import path from 'path';
import {execSync} from 'child_process';

registerCommand('new-prompt', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'showNewPromptPanel',
		};
	},
});

function readFileSafe(filePath: string, maxLen = 8192): string | null {
	try {
		if (!fs.existsSync(filePath)) return null;
		const buf = Buffer.alloc(maxLen);
		const fd = fs.openSync(filePath, 'r');
		const bytesRead = fs.readSync(fd, buf, 0, maxLen, 0);
		fs.closeSync(fd);
		return buf.toString('utf-8', 0, bytesRead);
	} catch {
		return null;
	}
}

/**
 * Universal tech-stack detection.
 * Scans root files, parses config files for each ecosystem,
 * and detects languages/frameworks/tooling.
 */
function detectTechStack(cwd: string, rootFileSet: Set<string>): string {
	const languages: string[] = [];
	const frameworks: string[] = [];
	const buildTools: string[] = [];
	const projectMeta: string[] = [];
	const deps: string[] = [];

	const has = (name: string) => rootFileSet.has(name);
	const hasAny = (...names: string[]) => names.some(n => has(n));

	// --- Node.js / JavaScript / TypeScript ---
	if (has('package.json')) {
		try {
			const pkg = JSON.parse(
				fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'),
			);
			if (pkg.name) projectMeta.push(`Name: ${pkg.name}`);
			if (pkg.description) projectMeta.push(`Description: ${pkg.description}`);

			const allDeps = {
				...pkg.dependencies,
				...pkg.devDependencies,
			};
			const depNames = Object.keys(allDeps);

			if (depNames.includes('typescript') || has('tsconfig.json'))
				languages.push('TypeScript');
			else languages.push('JavaScript');

			if (depNames.includes('next')) frameworks.push('Next.js');
			if (depNames.includes('nuxt') || depNames.includes('nuxt3'))
				frameworks.push('Nuxt');
			if (depNames.includes('react')) frameworks.push('React');
			if (depNames.includes('vue')) frameworks.push('Vue');
			if (depNames.includes('svelte')) frameworks.push('Svelte');
			if (depNames.includes('@angular/core')) frameworks.push('Angular');
			if (depNames.includes('express')) frameworks.push('Express');
			if (depNames.includes('fastify')) frameworks.push('Fastify');
			if (depNames.includes('koa')) frameworks.push('Koa');
			if (depNames.includes('nestjs') || depNames.includes('@nestjs/core'))
				frameworks.push('NestJS');
			if (depNames.includes('electron')) frameworks.push('Electron');
			if (depNames.includes('ink')) frameworks.push('Ink (CLI)');
			if (depNames.includes('react-native'))
				frameworks.push('React Native');
			if (depNames.includes('expo')) frameworks.push('Expo');
			if (depNames.includes('astro')) frameworks.push('Astro');
			if (depNames.includes('remix') || depNames.includes('@remix-run/node'))
				frameworks.push('Remix');
			if (depNames.includes('hono')) frameworks.push('Hono');

			if (depNames.includes('vite')) buildTools.push('Vite');
			if (depNames.includes('webpack')) buildTools.push('Webpack');
			if (depNames.includes('esbuild')) buildTools.push('esbuild');
			if (depNames.includes('rollup')) buildTools.push('Rollup');
			if (depNames.includes('turbo') || depNames.includes('turbopack'))
				buildTools.push('Turbopack');
			if (depNames.includes('tsup')) buildTools.push('tsup');

			if (has('pnpm-lock.yaml')) buildTools.push('pnpm');
			else if (has('yarn.lock')) buildTools.push('yarn');
			else if (has('bun.lockb') || has('bun.lock'))
				buildTools.push('Bun');
			else if (has('package-lock.json')) buildTools.push('npm');

			if (depNames.length) deps.push(`Node deps: ${depNames.join(', ')}`);
			if (pkg.scripts)
				deps.push(`Scripts: ${Object.keys(pkg.scripts).join(', ')}`);
		} catch {
			languages.push('JavaScript/TypeScript');
		}
	}

	// --- Python ---
	if (has('pyproject.toml')) {
		languages.push('Python');
		const content = readFileSafe(path.join(cwd, 'pyproject.toml'));
		if (content) {
			if (/\[tool\.poetry\]/.test(content)) buildTools.push('Poetry');
			else if (/\[build-system\]/.test(content)) buildTools.push('pyproject');
			const nameMatch = content.match(/^name\s*=\s*"(.+?)"/m);
			if (nameMatch && !projectMeta.length)
				projectMeta.push(`Name: ${nameMatch[1]}`);
			const descMatch = content.match(/^description\s*=\s*"(.+?)"/m);
			if (descMatch) projectMeta.push(`Description: ${descMatch[1]}`);
			if (/django/i.test(content)) frameworks.push('Django');
			if (/fastapi/i.test(content)) frameworks.push('FastAPI');
			if (/flask/i.test(content)) frameworks.push('Flask');
			if (/torch|pytorch/i.test(content)) frameworks.push('PyTorch');
			if (/tensorflow/i.test(content)) frameworks.push('TensorFlow');
			if (/langchain/i.test(content)) frameworks.push('LangChain');
			if (/streamlit/i.test(content)) frameworks.push('Streamlit');

			const depsMatch = content.match(
				/(?:dependencies|requires)\s*=\s*\[([\s\S]*?)\]/,
			);
			if (depsMatch?.[1]) {
				const pyDeps = depsMatch[1]
					.match(/"([^"]+)"/g)
					?.map(d => d.replace(/"/g, '').replace(/[><=!~].*/g, ''))
					.slice(0, 30);
				if (pyDeps?.length) deps.push(`Python deps: ${pyDeps.join(', ')}`);
			}
		}
	} else if (has('requirements.txt')) {
		languages.push('Python');
		const content = readFileSafe(path.join(cwd, 'requirements.txt'));
		if (content) {
			const pyDeps = content
				.split('\n')
				.map(l => l.trim())
				.filter(l => l && !l.startsWith('#'))
				.map(l => l.replace(/[><=!~\[].*/g, ''))
				.slice(0, 30);
			if (pyDeps.length) deps.push(`Python deps: ${pyDeps.join(', ')}`);
			if (pyDeps.some(d => /django/i.test(d))) frameworks.push('Django');
			if (pyDeps.some(d => /fastapi/i.test(d))) frameworks.push('FastAPI');
			if (pyDeps.some(d => /flask/i.test(d))) frameworks.push('Flask');
		}
	} else if (has('setup.py') || has('setup.cfg')) {
		languages.push('Python');
	}
	if (has('manage.py') && !frameworks.includes('Django'))
		frameworks.push('Django');
	if (
		(has('Pipfile') && !buildTools.includes('Pipenv'))
	)
		buildTools.push('Pipenv');
	if (has('uv.lock')) buildTools.push('uv');

	// --- Rust ---
	if (has('Cargo.toml')) {
		languages.push('Rust');
		buildTools.push('Cargo');
		const content = readFileSafe(path.join(cwd, 'Cargo.toml'));
		if (content) {
			const nameMatch = content.match(/^name\s*=\s*"(.+?)"/m);
			if (nameMatch && !projectMeta.length)
				projectMeta.push(`Name: ${nameMatch[1]}`);
			const descMatch = content.match(/^description\s*=\s*"(.+?)"/m);
			if (descMatch) projectMeta.push(`Description: ${descMatch[1]}`);
			if (/actix/i.test(content)) frameworks.push('Actix');
			if (/axum/i.test(content)) frameworks.push('Axum');
			if (/rocket/i.test(content)) frameworks.push('Rocket');
			if (/tokio/i.test(content)) frameworks.push('Tokio');
			if (/tauri/i.test(content)) frameworks.push('Tauri');

			const depSection = content.match(
				/\[dependencies\]([\s\S]*?)(?:\n\[|\n*$)/,
			);
			if (depSection?.[1]) {
				const rustDeps = depSection[1]
					.split('\n')
					.map(l => l.match(/^(\w[\w-]*)\s*=/)?.[1])
					.filter(Boolean)
					.slice(0, 30);
				if (rustDeps.length)
					deps.push(`Rust deps: ${rustDeps.join(', ')}`);
			}
		}
	}

	// --- Go ---
	if (has('go.mod')) {
		languages.push('Go');
		const content = readFileSafe(path.join(cwd, 'go.mod'));
		if (content) {
			const modMatch = content.match(/^module\s+(.+)/m);
			if (modMatch?.[1] && !projectMeta.length)
				projectMeta.push(`Module: ${modMatch[1].trim()}`);
			if (/gin-gonic/i.test(content)) frameworks.push('Gin');
			if (/go-fiber/i.test(content)) frameworks.push('Fiber');
			if (/echo.*labstack/i.test(content)) frameworks.push('Echo');
			if (/gorilla\/mux/i.test(content)) frameworks.push('Gorilla Mux');

			const requireBlock = content.match(
				/require\s*\(([\s\S]*?)\)/,
			);
			if (requireBlock?.[1]) {
				const goDeps = requireBlock[1]
					.split('\n')
					.map(l => l.trim().split(/\s+/)[0])
					.filter(d => d && !d.startsWith('//'))
					.slice(0, 30);
				if (goDeps.length) deps.push(`Go deps: ${goDeps.join(', ')}`);
			}
		}
	}

	// --- Java / Kotlin ---
	if (hasAny('pom.xml', 'build.gradle', 'build.gradle.kts')) {
		if (has('build.gradle.kts') || has('src/main/kotlin'))
			languages.push('Kotlin');
		else languages.push('Java');
		if (has('pom.xml')) buildTools.push('Maven');
		if (hasAny('build.gradle', 'build.gradle.kts'))
			buildTools.push('Gradle');
		const pomContent =
			has('pom.xml') && readFileSafe(path.join(cwd, 'pom.xml'));
		if (pomContent) {
			if (/spring-boot/i.test(pomContent))
				frameworks.push('Spring Boot');
			if (/quarkus/i.test(pomContent)) frameworks.push('Quarkus');
		}
		const gradleFile = has('build.gradle.kts')
			? 'build.gradle.kts'
			: 'build.gradle';
		const gradleContent =
			has(gradleFile) && readFileSafe(path.join(cwd, gradleFile));
		if (gradleContent) {
			if (/spring-boot/i.test(gradleContent))
				frameworks.push('Spring Boot');
			if (/android/i.test(gradleContent)) frameworks.push('Android');
			if (/ktor/i.test(gradleContent)) frameworks.push('Ktor');
		}
	}

	// --- .NET / C# ---
	const csprojFiles = [...rootFileSet].filter(f => f.endsWith('.csproj'));
	const slnFiles = [...rootFileSet].filter(f => f.endsWith('.sln'));
	if (csprojFiles.length || slnFiles.length) {
		languages.push('C#/.NET');
		if (csprojFiles.length) {
			const content = readFileSafe(
				path.join(cwd, csprojFiles[0]!),
			);
			if (content) {
				if (/Blazor|Microsoft\.AspNetCore/i.test(content))
					frameworks.push('ASP.NET');
				if (/Xamarin/i.test(content)) frameworks.push('Xamarin');
				if (/MAUI/i.test(content)) frameworks.push('.NET MAUI');
			}
		}
		buildTools.push('dotnet');
	}

	// --- Ruby ---
	if (has('Gemfile')) {
		languages.push('Ruby');
		buildTools.push('Bundler');
		const content = readFileSafe(path.join(cwd, 'Gemfile'));
		if (content) {
			if (/['"]rails['"]/.test(content)) frameworks.push('Rails');
			if (/['"]sinatra['"]/.test(content)) frameworks.push('Sinatra');
		}
	}

	// --- PHP ---
	if (has('composer.json')) {
		languages.push('PHP');
		buildTools.push('Composer');
		try {
			const pkg = JSON.parse(
				fs.readFileSync(path.join(cwd, 'composer.json'), 'utf-8'),
			);
			if (pkg.name && !projectMeta.length)
				projectMeta.push(`Name: ${pkg.name}`);
			if (pkg.description) projectMeta.push(`Description: ${pkg.description}`);
			const phpDeps = pkg.require ? Object.keys(pkg.require) : [];
			if (phpDeps.some(d => /laravel/i.test(d)))
				frameworks.push('Laravel');
			if (phpDeps.some(d => /symfony/i.test(d)))
				frameworks.push('Symfony');
			if (phpDeps.length)
				deps.push(`PHP deps: ${phpDeps.join(', ')}`);
		} catch {
			// ignore
		}
	}

	// --- Swift ---
	if (has('Package.swift')) {
		languages.push('Swift');
		buildTools.push('Swift Package Manager');
		if (hasAny('*.xcodeproj', '*.xcworkspace'))
			buildTools.push('Xcode');
		const content = readFileSafe(path.join(cwd, 'Package.swift'));
		if (content) {
			if (/Vapor/i.test(content)) frameworks.push('Vapor');
		}
	}

	// --- Dart / Flutter ---
	if (has('pubspec.yaml')) {
		const content = readFileSafe(path.join(cwd, 'pubspec.yaml'));
		if (content && /flutter/i.test(content)) {
			languages.push('Dart');
			frameworks.push('Flutter');
		} else {
			languages.push('Dart');
		}
	}

	// --- C / C++ ---
	if (has('CMakeLists.txt')) {
		languages.push('C/C++');
		buildTools.push('CMake');
	} else if (has('Makefile') || has('makefile')) {
		if (!languages.length) languages.push('C/C++ (Makefile detected)');
		buildTools.push('Make');
	} else if (has('meson.build')) {
		languages.push('C/C++');
		buildTools.push('Meson');
	}

	// --- Zig ---
	if (has('build.zig')) {
		languages.push('Zig');
	}

	// --- Elixir ---
	if (has('mix.exs')) {
		languages.push('Elixir');
		buildTools.push('Mix');
		const content = readFileSafe(path.join(cwd, 'mix.exs'));
		if (content && /phoenix/i.test(content)) frameworks.push('Phoenix');
	}

	// --- Tooling / Infrastructure ---
	if (hasAny('Dockerfile', 'docker-compose.yml', 'docker-compose.yaml'))
		buildTools.push('Docker');
	if (has('.github')) buildTools.push('GitHub Actions');
	if (has('.gitlab-ci.yml')) buildTools.push('GitLab CI');
	if (has('Jenkinsfile')) buildTools.push('Jenkins');
	if (has('terraform.tf') || has('main.tf')) buildTools.push('Terraform');
	if (has('k8s') || has('kubernetes')) buildTools.push('Kubernetes');
	if (has('serverless.yml') || has('serverless.yaml'))
		buildTools.push('Serverless');
	if (hasAny('nx.json')) buildTools.push('Nx');
	if (hasAny('lerna.json')) buildTools.push('Lerna');
	if (has('turbo.json')) buildTools.push('Turborepo');

	// --- Fallback: scan file extensions if no language detected ---
	if (!languages.length) {
		try {
			const exts = new Map<string, number>();
			const entries = fs.readdirSync(cwd, {withFileTypes: true});
			const srcDirs = ['src', 'lib', 'app', 'source', 'cmd', 'pkg', 'internal'];
			const dirsToScan = [cwd];
			for (const d of srcDirs) {
				const full = path.join(cwd, d);
				if (entries.some(e => e.name === d && e.isDirectory()))
					dirsToScan.push(full);
			}
			for (const dir of dirsToScan) {
				try {
					const files = fs.readdirSync(dir);
					for (const f of files) {
						const ext = path.extname(f).toLowerCase();
						if (ext) exts.set(ext, (exts.get(ext) || 0) + 1);
					}
				} catch {
					// ignore
				}
			}
			const extToLang: Record<string, string> = {
				'.ts': 'TypeScript', '.tsx': 'TypeScript',
				'.js': 'JavaScript', '.jsx': 'JavaScript',
				'.py': 'Python', '.rs': 'Rust', '.go': 'Go',
				'.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin',
				'.cs': 'C#', '.fs': 'F#',
				'.rb': 'Ruby', '.php': 'PHP',
				'.swift': 'Swift', '.m': 'Objective-C',
				'.dart': 'Dart', '.zig': 'Zig',
				'.c': 'C', '.cpp': 'C++', '.cc': 'C++', '.h': 'C/C++',
				'.ex': 'Elixir', '.exs': 'Elixir',
				'.scala': 'Scala', '.clj': 'Clojure',
				'.lua': 'Lua', '.r': 'R',
				'.jl': 'Julia', '.hs': 'Haskell',
				'.vue': 'Vue', '.svelte': 'Svelte',
			};
			const detected = new Set<string>();
			for (const [ext] of [...exts.entries()].sort((a, b) => b[1] - a[1])) {
				const lang = extToLang[ext];
				if (lang && !detected.has(lang)) {
					detected.add(lang);
					languages.push(lang);
				}
				if (detected.size >= 3) break;
			}
		} catch {
			// ignore
		}
	}

	// Assemble output
	const lines: string[] = [];
	if (projectMeta.length) lines.push(projectMeta.join('\n'));
	if (languages.length) lines.push(`Languages: ${languages.join(', ')}`);
	if (frameworks.length) lines.push(`Frameworks: ${frameworks.join(', ')}`);
	if (buildTools.length) lines.push(`Build/Tooling: ${buildTools.join(', ')}`);
	if (deps.length) lines.push(deps.join('\n'));

	return lines.length ? `[Tech Stack]\n${lines.join('\n')}` : '';
}

/**
 * Collect project context: tech stack, AGENTS.md, directory structure, git, env.
 */
function gatherProjectContext(): string {
	const cwd = process.cwd();
	const sections: string[] = [];

	let rootFileSet: Set<string>;
	try {
		rootFileSet = new Set(fs.readdirSync(cwd));
	} catch {
		rootFileSet = new Set();
	}

	// Tech stack detection (universal)
	const techStack = detectTechStack(cwd, rootFileSet);
	if (techStack) sections.push(techStack);

	// Git branch
	try {
		const branch = execSync('git branch --show-current', {
			cwd,
			encoding: 'utf-8',
			timeout: 3000,
			stdio: ['pipe', 'pipe', 'pipe'],
		}).trim();
		if (branch) sections.push(`[Git] Branch: ${branch}`);
	} catch {
		// ignore
	}

	// AGENTS.md
	try {
		const agentsPath = path.join(cwd, 'AGENTS.md');
		if (fs.existsSync(agentsPath)) {
			const content = fs.readFileSync(agentsPath, 'utf-8').trim();
			if (content) {
				const truncated =
					content.length > 1500
						? content.slice(0, 1500) + '\n...(truncated)'
						: content;
				sections.push(
					`[Project Documentation - AGENTS.md]\n${truncated}`,
				);
			}
		}
	} catch {
		// ignore
	}

	// Top-level directory structure
	try {
		const entries = fs.readdirSync(cwd, {withFileTypes: true});
		const ignore = new Set([
			'node_modules', '.git', '.DS_Store', 'dist', 'build',
			'.next', '.nuxt', 'coverage', '__pycache__', '.venv',
			'venv', 'target', '.idea', '.vscode',
		]);
		const items = entries
			.filter(e => !ignore.has(e.name))
			.map(e => (e.isDirectory() ? `${e.name}/` : e.name))
			.slice(0, 40);
		if (items.length)
			sections.push(`[Project Structure (root)]\n${items.join('\n')}`);
	} catch {
		// ignore
	}

	// System environment
	sections.push(`[Environment]\n${getSystemEnvironmentInfo()}`);

	return sections.join('\n\n');
}

/**
 * Streaming prompt generator.
 * Yields content chunks as they arrive, allowing the UI to update in real-time.
 */
export async function* streamGeneratePrompt(
	userRequirement: string,
	abortSignal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
	const config = getOpenAiConfig();
	const model = config.advancedModel || config.basicModel;
	if (!model) {
		throw new Error('No model configured');
	}

	const agents = getSubAgents();
	const agentDescriptions = agents.length
		? agents.map(a => `- ${a.name} (${a.id}): ${a.description}`).join('\n')
		: '';

	const projectContext = gatherProjectContext();

	const systemMessage = `You are a professional prompt engineer. The user will describe a requirement, and you need to generate a well-structured, detailed prompt that the user can send to an AI coding assistant.

## Current Project Context
${projectContext}

## Guidelines for generating the prompt
1. Analyze the user's requirement thoroughly
2. Write a clear, actionable prompt in the user's language
3. Leverage the project context above to include accurate technical details (tech stack, file paths, conventions)
4. Structure the prompt with clear sections if needed (e.g. context, requirements, constraints, expected output)
5. Keep the prompt focused and avoid unnecessary verbosity
6. Reference specific file paths, function names, dependencies, or patterns from the project context when relevant
7. The generated prompt should be ready to use directly - no meta-commentary
${agentDescriptions ? `\nNote: The AI assistant also supports the following sub-agents. If you think delegating part of the task to a sub-agent would be beneficial, you may optionally mention it (prefix with agent_), but only when it clearly adds value:\n${agentDescriptions}\n` : ''}
Output ONLY the generated prompt text, nothing else.`;

	const messages: ChatMessage[] = [
		{role: 'system', content: systemMessage},
		{role: 'user', content: userRequirement},
	];

	let stream: AsyncGenerator<any, void, unknown>;

	switch (config.requestMethod) {
		case 'anthropic':
			stream = createStreamingAnthropicCompletion(
				{
					model,
					messages,
					max_tokens: 4096,
					includeBuiltinSystemPrompt: false,
					disableThinking: true,
				},
				abortSignal,
			);
			break;

		case 'gemini':
			stream = createStreamingGeminiCompletion(
				{
					model,
					messages,
					includeBuiltinSystemPrompt: false,
					disableThinking: true,
				},
				abortSignal,
			);
			break;

		case 'responses':
			stream = createStreamingResponse(
				{
					model,
					messages,
					stream: true,
					includeBuiltinSystemPrompt: false,
					disableThinking: true,
				},
				abortSignal,
			);
			break;

		case 'chat':
		default:
			stream = createStreamingChatCompletion(
				{
					model,
					messages,
					stream: true,
					includeBuiltinSystemPrompt: false,
					disableThinking: true,
				},
				abortSignal,
			);
			break;
	}

	for await (const chunk of stream) {
		if (abortSignal?.aborted) break;

		if (chunk && typeof chunk === 'object') {
			if (chunk.type === 'content' && typeof chunk.content === 'string') {
				yield chunk.content;
				continue;
			}
			const deltaContent = (chunk as any).choices?.[0]?.delta?.content;
			if (typeof deltaContent === 'string') {
				yield deltaContent;
			}
		}
	}
}

export default {};
