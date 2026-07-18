import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';

// Maximum length of the original user prompt to show under the command
// message tree node (` └─ <prompt>`). Longer text gets truncated with an
// ellipsis. Keep this conservative so the chat row stays single-line on
// most terminals.
const PROMPT_PREVIEW_MAX = 120;

function truncatePrompt(text: string): string {
	const flat = text.replace(/\s+/g, ' ').trim();
	if (flat.length <= PROMPT_PREVIEW_MAX) return flat;
	return flat.slice(0, PROMPT_PREVIEW_MAX - 1).trimEnd() + '\u2026';
}

// Deep Research command handler - runs an autonomous multi-step web research workflow
// and writes a final markdown report into .snow/deepresearch/<task-name>.md
registerCommand('deepresearch', {
	execute: (args?: string): CommandResult => {
		const topic = args?.trim();
		if (!topic) {
			const lang = getCurrentLanguage();
			const usage =
				translations[lang]?.commandPanel?.commandOutput?.deepResearch?.usage ||
				'Usage: /deepresearch <prompt>\nExample: /deepresearch Compare the architectures of OpenAI Deep Research and Gemini Deep Research';
			return {
				success: false,
				message: usage,
			};
		}

		const prompt = `You are operating in **Deep Research Mode**. Conduct a comprehensive, multi-step web research investigation on the user's request and produce a detailed, well-structured, and well-cited markdown report with rich visualizations.

## User's Research Request
${topic}

## Workflow: Clarify -> Plan -> Deep Search Loop -> Analysis -> Synthesize -> Report

### Step 1: Intent Clarification (only if ambiguous)
If the request is **clearly scoped** (specific topic, audience, depth), skip clarification and proceed directly to Step 2.

If any of the following are unclear, you **MUST** call \`askuser-ask_question\` exactly once to disambiguate:
- The research goal is too broad or has multiple plausible interpretations
- The target audience / depth (overview vs. deep technical) is unspecified and matters
- A critical constraint (time range, language, region, source type) is missing

Ask **at most one** focused question with concrete options. Do not over-clarify - if reasonable defaults exist, use them and document the assumption in the final report.

### Step 2: Comprehensive Research Plan
Before searching, internally plan:
- **Deep Decompose** the request into 6-10 concrete sub-questions covering different dimensions (history, trends, comparison, pros/cons, future outlook, implementation details, etc.)
- For each sub-question, draft 2-3 candidate search queries:
  - Search in English (for breadth of sources)
  - Search in the user's language if different (for local/regional perspective)
  - Search with different keywords and angles (e.g., "comparison", "tutorial", "case study", "research paper", "industry report")
- Identify dependencies and research order

Use \`todo-manage\` (action: add) to track each sub-question as a TODO item. Update each TODO immediately as you finish that sub-question.

### Step 3: Intensive Multi-Faceted Search Loop
**Research budget**: Total 20-35 search calls and 12-20 page fetches across the whole research.

For each sub-question, execute this enhanced loop:

1. **Initial Search** with \`websearch-search\` using the planned query (request 10-15 results)
2. **Source Evaluation**: Review the entire result list:
   - Identify 2-3 most credible sources (official docs, primary sources, reputable publications, recent academic papers, industry reports)
   - Evaluate source authority, recency, and relevance
   - Skip low-quality / SEO-spam / outdated results
3. **Fetch Multiple Sources** - Retrieve 2-3 top sources with \`websearch-fetch\` (set \`isUserProvided: false\`, \`enableAiSummary: true\`, and pass the user's original question as \`userQuery\` for AI compression. If you need the original full text instead of a summary, set \`enableAiSummary: false\`.)
4. **Deep Extraction** - Extract not just facts but:
   - Specific numbers, statistics, metrics
   - Quotes and expert opinions
   - Methodologies and technical details
   - Trends and patterns
   - Contradictions or debates in the field
5. **Cross-Validation** - For important claims:
   - Verify with at least 2 independent sources
   - Document any conflicting views
   - Note source quality and potential biases
6. **Adaptive Querying** - If initial results are weak:
   - Refine search terms (different keywords, modifiers like "latest", "comparison", "vs")
   - Try different search angles
   - Search related topics that might contain the information
   - Aim for **3-5 search iterations per sub-question** before moving on

### Step 4: Multi-Dimensional Analysis
Synthesize findings across multiple dimensions:
- **Temporal**: How has this topic evolved over time? What are the latest developments?
- **Comparative**: How do different options/approaches compare? Create comparison matrices.
- **Causal**: What drives these trends? What are the underlying reasons?
- **Practical**: What are the real-world implications? Use cases? Implementation considerations?
- **Controversial**: Are there competing viewpoints? How do they differ?

### Step 5: Rich Synthesis & Report Generation
After research is complete:

1. Aggregate findings by sub-question, then organize by logical themes
2. Build a hierarchical outline with 2-3 levels of detail
3. **Report Language Rule** (strict priority):
   - If the user **explicitly specifies** an output language in their request (e.g. "用英文输出", "write in Japanese", "respond in French"), use that specified language for the entire report.
   - Otherwise, **detect the language of the user's original request** (${topic}) and write the **entire report in that same language**, including headings, body, table cells, and Mermaid diagram labels. Only proper nouns, code, URLs, and technical terms without natural translation may remain in their original form.
   - Never mix languages within the report unless the user explicitly asks for a bilingual output.
4. **Every non-trivial claim MUST have an inline footnote** in the form \`[^1]\`, \`[^2]\`, ... linked to References (Markdown footnote syntax)
5. **Minimum word count**: 2000+ words (substantial depth, not superficial coverage)
6. **Include visual elements**: Use Markdown formatting with tables, code blocks, quotes, and **images** (when relevant images are found during web search).
7. **Add at least one visualization** using Mermaid, structured Markdown, or images:
   - Timeline (for historical evolution)
   - Comparison table (for multi-option analysis)
   - Flow diagram (for processes or relationships)
   - Architecture diagram (for technical topics)
   - Trend analysis (for emerging patterns)
   - **Images from credible web sources** (architecture diagrams, charts, screenshots, infographics)
8. **Image Embedding Rules** (when valid images are discovered via web search):
   - Only embed images from credible, directly accessible URLs (official docs, research papers, reputable publications). Verify the image URL was actually returned by \`websearch-search\` or found in a fetched page; never fabricate image URLs.
   - Use standard Markdown image syntax: \`![descriptive alt text](https://example.com/image.png)\`
   - Add a caption line below using italics, e.g. \`*Figure 1: Architecture overview (Source: [^N])*\`
   - Each embedded image MUST also have a footnote citation \`[^N]\` pointing to the source page
   - Prefer images that genuinely add information (diagrams, charts, comparison visuals); avoid decorative stock photos
   - If no high-quality image was found, skip image embedding rather than forcing low-value images

### Step 6: Save the Report
- **Output path**: \`.snow/deepresearch/[task-slug].md\` in the project root (use \`process.cwd()\`).
- Generate \`task-slug\` from the topic: lowercase, alphanumeric + hyphens, max 60 chars. Append a short timestamp suffix \`-YYYYMMDD-HHmm\` to avoid collisions.
- Use \`filesystem-create\` to write the file. If the directory \`.snow/deepresearch/\` does not exist, the create tool will auto-create parents.

## Report Markdown Template (Enhanced Structure)

\`\`\`markdown
# [Research Title: Clear, Descriptive Heading]

> Research request: [original user prompt, verbatim]
> Depth: [overview / intermediate / deep technical]
> Generated: [ISO timestamp]
> Total sources analyzed: [N]
> Last updated: [date]

## Executive Summary (TL;DR)
[4-8 bullet points capturing the most important conclusions and key takeaways, each with inline citations. Include quantified findings where relevant.]

## Table of Contents
1. [Background & Scope]
2. [Key Findings]
3. [Detailed Analysis]
4. [Comparison & Trends]
5. [Recommendations & Outlook]
6. [Limitations & Future Research]

## Background & Scope
### Why This Matters
[1-2 paragraphs explaining the context and relevance of this research topic]

### Scope Definition
[What is covered and what is NOT covered. Key assumptions and clarifications adopted.]

### Key Terminology
[Define specialized terms if needed; use a simple list or brief explanations]

## Key Findings
### Finding 1: [Major Insight Title]
[2-3 paragraphs with detailed explanation, concrete examples, and citations [X]. Include numbers, quotes, and specific facts.]

### Finding 2: [Major Insight Title]
[Detailed content with evidence and citations]

### Finding 3: [Major Insight Title]
[Detailed content with evidence and citations]

## Detailed Analysis

### [Major Theme 1]
#### Sub-theme 1.1
[Comprehensive analysis with citations, examples, and supporting data]

#### Sub-theme 1.2
[Comprehensive analysis]

### [Major Theme 2]
#### Sub-theme 2.1
[Comprehensive analysis with citations]

#### Sub-theme 2.2
[Comprehensive analysis]

## Comparison & Visualization Matrix
### [Option/Approach Comparison Table]
| Aspect | Option A | Option B | Option C | Best For | Source |
|--------|----------|----------|----------|----------|--------|
| Ease of Use | High | Medium | Low | Beginners | [^1] |
| Performance | Medium | High | Very High | Enterprises | [^2] |
| Cost | Low | Medium | High | Budget-conscious | [^3] |
| Learning Curve | Gentle | Moderate | Steep | Experts | [^1] |

### [Timeline or Evolution Diagram - Mermaid]
\`\`\`mermaid
timeline
    title Historical Evolution of [Topic]
    2020 : Early Stage : Initial Concept
    2021 : Growth Phase : Rapid Adoption
    2022 : Maturation : Standardization
    2023 : Refinement : Industry Focus
    2024 : Current State : [Key Developments]
\`\`\`

### [Process or Architecture Diagram - Mermaid if applicable]
\`\`\`mermaid
graph LR
    A[Input] --> B[Processing]
    B --> C[Decision Point]
    C -->|Path 1| D[Output A]
    C -->|Path 2| E[Output B]
\`\`\`

### [Reference Image from Web Source - if available]
![Architecture diagram of the system](https://example.com/diagram.png)
*Figure 1: System architecture overview (Source: [^N])*

## Trends & Future Outlook
### Current Trends [^4]
[Analysis of emerging patterns, technologies, methodologies, or market movements]

### Projected Developments
[Based on current trajectory and expert opinions, discuss likely future developments]

### Emerging Challenges
[What obstacles or concerns are emerging in this field?]

## Recommendations & Best Practices
- [Actionable recommendation 1 with citation and rationale]
- [Actionable recommendation 2 with citation and rationale]
- [Actionable recommendation 3 with citation and rationale]

## Open Questions & Limitations
### What Remains Uncertain
- [Open question 1 and why it matters]
- [Open question 2 and why it matters]
- [Open question 3 that would require further research]

### Research Limitations
- [Sources that conflicted and how the conflict was handled]
- [Geographic or temporal limitations of findings]
- [Topics that would need deeper / paywalled research]
- [Language constraints in available sources]

### Methodology Notes
- Search strategy used: [keywords, languages, search angles]
- Time period covered: [date range]
- Source types: [academic, industry reports, news, official docs, etc.]

## References (Markdown Footnotes)

Use standard Markdown footnote syntax. Define each footnote at the bottom of the document like this:

[^1]: [Full Page Title] - https://example.com/article-1 (Accessed: [Date])
[^2]: [Full Page Title] - https://example.com/article-2 (Accessed: [Date])
[^3]: [Report Title] - https://example.com/report ([Organization])
[^4]: [Research Paper Title] - https://example.com/paper ([Journal/Conference])

[Continue numbering all sources as [^5], [^6], ...]

## Appendix (Optional)
### Data Tables
[Additional detailed data, statistics, or full quotes that don't fit in main sections]

### Additional Resources
- [Links to tools, communities, learning resources related to this topic]
- [Further reading recommendations]
\`\`\`

## Final Step: Confirm Completion
After saving the file, reply with a concise confirmation that includes:
- The exact saved file path (\`.snow/deepresearch/...\`)
- A 2-3 sentence executive summary of the major conclusions
- The number of sources cited
- Key metrics: total word count and number of sub-questions researched

## Hard Rules
1. **Always cite extensively using Markdown footnote syntax** - every factual claim has a footnote reference like \`[^1]\` in the body, with a matching definition \`[^1]: source description - URL\` listed in the References section. Never invent sources.
2. **No hallucination** - if you cannot verify a fact through search, mark it explicitly as "unconfirmed" or omit it.
3. **Report language priority** - If the user explicitly requests a specific output language, follow that. Otherwise the report language MUST match the language of the user's original request (auto-detect from the prompt above). Apply this rule to all section titles, body text, tables, and diagram labels.
4. **One clarification at most** via \`askuser-ask_question\`, only when truly necessary.
5. **Track progress with TODO** and update items immediately as each sub-question is finished.
6. **Save to \`.snow/deepresearch/\`** - this is the only valid output location.
7. **Minimum 2000 words** - reports must be substantive and comprehensive, not superficial.
8. **Visualizations required** - include at least one Mermaid diagram, table, or structured visualization.
9. **Multi-sourced validation** - important claims must be verified against at least 2 independent sources.
10. **Embed real images when valuable** - if web search returns relevant, credible images (diagrams, charts, infographics), embed them with \`![alt](url)\` Markdown syntax plus a footnote-cited caption. Never fabricate image URLs.
11. **Deep research budget** - aim for 20-35 searches and 12-20 page fetches; invest time in quality over speed.

Begin now. Create a detailed research plan with 6-10 sub-questions, then execute the intensive search loop.`;

		return {
			success: true,
			action: 'deepResearch',
			// Pass the truncated user prompt back as `message` so the UI layer can
			// render it under the command tree node without exposing the long
			// internal AI prompt.
			message: truncatePrompt(topic),
			prompt,
		};
	},
});

export default {};
