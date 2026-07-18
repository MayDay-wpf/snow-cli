package com.snow.plugin.nextEdit

import com.intellij.openapi.diagnostic.Logger
import com.snow.plugin.completion.SnowCompletionConfig
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

data class DiagnosticHint(
    val line: Int,         // 1-indexed
    val column: Int,       // 1-indexed
    val severity: String,  // "error" or "warning"
    val message: String,
    val source: String? = null,
    val code: String? = null,
)

data class WorkspaceFileContext(
    val path: String,
    val content: String,
    val diagnostics: List<DiagnosticHint> = emptyList(),
)

data class NextEditAiRequest(
    val editFile: String,
    val editOldText: String,
    val editNewText: String,
    val editLine: Int,
    val currentFilePath: String,
    val currentLanguageId: String,
    val currentFileContent: String,
    val currentFileDiagnostics: List<DiagnosticHint> = emptyList(),
    val workspaceFiles: List<WorkspaceFileContext>,
)

data class NextEditAiCandidate(
    val file: String,
    val oldText: String,
    val newText: String,
    val reason: String,
)

private val SYSTEM_INSTRUCTION = listOf(
    "You are a Next Edit prediction engine inside an IDE.",
    "The user has just performed a small edit in their codebase. You will be given:",
    "  - The previous text segment (BEFORE) and the new text segment (AFTER) of that edit, together with the file path and line.",
    "  - The full content of the currently edited file (with line numbers).",
    "  - A list of workspace files that may be related (with paths and line numbers).",
    "  - For each file, a [DIAGNOSTICS] block listing IDE-detected errors and warnings (with line:column, source, code, and message).",
    "Your task: predict OTHER places in the codebase that should now also be updated as a logical consequence of the user's edit.",
    "Typical cases include: renaming a symbol everywhere, updating callers after a signature change, propagating logic changes to related sites, updating tests, mirroring naming changes across modules, etc.",
    "Diagnostics guidance:",
    "  - PREFER predicting edits that would fix the listed diagnostics when they are a direct consequence of the user's edit (missing imports, type mismatches, unresolved references, callers not updated after a signature change, etc.).",
    "  - Do NOT invent fixes just to clear diagnostics. Only emit an edit when you are confident in the fix AND the oldText exists exactly in the target file.",
    "  - Ignore unrelated pre-existing diagnostics.",
    "Hard rules:",
    "1. Output a JSON array. No prose. No markdown code fences. No extra commentary.",
    "2. Each element MUST be an object with EXACTLY these string fields: \"file\", \"oldText\", \"newText\", \"reason\".",
    "3. \"file\" is the absolute or workspace-relative path of the target file (use the same path style as in the input).",
    "4. \"oldText\" MUST be an exact, character-for-character substring of the target file's content. It should be unique within that file, or close to it. Include enough surrounding characters to make it unambiguous, but keep it short.",
    "5. \"newText\" is the replacement text. It must NOT equal oldText.",
    "6. \"reason\" is a short human-readable explanation (one sentence).",
    "7. Do not include the location the user just edited (BEFORE/AFTER) itself.",
    "8. If there is nothing to update, output exactly: []",
    "9. NEVER wrap the JSON in ```json fences. Output raw JSON only.",
).joinToString("\n")

object SnowNextEditClient {
    private val logger = Logger.getInstance(SnowNextEditClient::class.java)
    private val httpClient: HttpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(30))
        .build()

    // Next Edit needs enough tokens for a JSON array of structured candidates
    // (each with oldText/newText/reason). The shared completion config defaults
    // to 256 which is fine for inline completion but causes empty content here
    // (especially for reasoning models that burn tokens on hidden thinking).
    private const val MIN_NEXT_EDIT_TOKENS = 2048
    private fun maxTokens(config: SnowCompletionConfig): Int =
        maxOf(config.maxTokens, MIN_NEXT_EDIT_TOKENS)

    fun requestCandidates(config: SnowCompletionConfig, req: NextEditAiRequest): List<NextEditAiCandidate> {
        val raw = try {
            when (config.provider) {
                "chat" -> requestChat(config, req)
                "fim" -> requestChat(config, req) // FIM is not suited to JSON instruction following; fall back to chat
                "responses" -> requestResponses(config, req)
                "anthropic" -> requestAnthropic(config, req)
                "gemini" -> requestGemini(config, req)
                else -> {
                    logger.warn("Unknown completion provider for Next Edit: ${config.provider}")
                    return emptyList()
                }
            }
        } catch (e: Exception) {
            logger.warn("Next Edit AI request failed: ${e.message}", e)
            return emptyList()
        }

        return parseCandidates(raw)
    }

    private fun buildUserMessage(req: NextEditAiRequest): String = buildString {
        appendLine("=== USER'S RECENT EDIT ===")
        appendLine("File: ${req.editFile}")
        appendLine("Line: ${req.editLine + 1}")
        appendLine("Language: ${req.currentLanguageId}")
        appendLine()
        appendLine("BEFORE:")
        appendLine("```")
        append(req.editOldText)
        if (!req.editOldText.endsWith("\n")) appendLine() else { /* already has newline */ }
        appendLine("```")
        appendLine()
        appendLine("AFTER:")
        appendLine("```")
        append(req.editNewText)
        if (!req.editNewText.endsWith("\n")) appendLine() else { /* already has newline */ }
        appendLine("```")
        appendLine()
        appendLine("=== CURRENT FILE (with line numbers) ===")
        appendLine("Path: ${req.currentFilePath}")
        appendLine("```")
        append(req.currentFileContent)
        if (!req.currentFileContent.endsWith("\n")) appendLine()
        appendLine("```")
        appendDiagnosticsBlock(req.currentFileDiagnostics)
        appendLine()
        if (req.workspaceFiles.isNotEmpty()) {
            appendLine("=== RELATED WORKSPACE FILES ===")
            for (wf in req.workspaceFiles) {
                appendLine()
                appendLine("--- ${wf.path} ---")
                appendLine("```")
                append(wf.content)
                if (!wf.content.endsWith("\n")) appendLine()
                appendLine("```")
                appendDiagnosticsBlock(wf.diagnostics)
            }
            appendLine()
        }
        appendLine("=== TASK ===")
        appendLine("Predict other locations that should be updated as a consequence of the user's edit. Output a JSON array as specified. If nothing else needs to change, output [].")
    }

    private fun StringBuilder.appendDiagnosticsBlock(diagnostics: List<DiagnosticHint>) {
        appendLine("[DIAGNOSTICS]")
        if (diagnostics.isEmpty()) {
            appendLine("  (none)")
            return
        }
        for (d in diagnostics) {
            val sourcePart = if (!d.source.isNullOrBlank()) " (${d.source})" else ""
            val codePart = if (!d.code.isNullOrBlank()) " [${d.code}]" else ""
            appendLine("  [${d.severity}] L${d.line}:${d.column}$sourcePart$codePart ${d.message}")
        }
    }


    private fun requestChat(config: SnowCompletionConfig, req: NextEditAiRequest): String {
        val url = "${config.resolveBaseUrl()}/chat/completions"
        val body = JSONObject()
            .put("model", config.model)
            .put("temperature", config.temperature)
            .put("max_tokens", maxTokens(config))
            .put("messages", JSONArray()
                .put(JSONObject().put("role", "system").put("content", SYSTEM_INSTRUCTION))
                .put(JSONObject().put("role", "user").put("content", buildUserMessage(req))))

        val data = postJson(url, config, null, body)
        val choice = data.optJSONArray("choices")?.optJSONObject(0)
        val finishReason = choice?.optString("finish_reason", "") ?: ""
        if (finishReason.isNotBlank()) logger.info("Next Edit [chat] finish_reason=$finishReason")
        return data.optJSONArray("choices")
            ?.optJSONObject(0)
            ?.optJSONObject("message")
            ?.optString("content", "")
            .orEmpty()
    }

    private fun requestResponses(config: SnowCompletionConfig, req: NextEditAiRequest): String {
        val url = "${config.resolveBaseUrl()}/responses"
        val body = JSONObject()
            .put("model", config.model)
            .put("max_output_tokens", maxTokens(config))
            .put("temperature", config.temperature)
            .put("input", JSONArray()
                .put(JSONObject().put("role", "system")
                    .put("content", JSONArray().put(JSONObject().put("type", "input_text").put("text", SYSTEM_INSTRUCTION))))
                .put(JSONObject().put("role", "user")
                    .put("content", JSONArray().put(JSONObject().put("type", "input_text").put("text", buildUserMessage(req))))))

        val data = postJson(url, config, null, body)
        return extractResponsesText(data)
    }

    private fun requestAnthropic(config: SnowCompletionConfig, req: NextEditAiRequest): String {
        val baseUrl = config.state.baseUrl.trim().ifEmpty { "https://api.anthropic.com" }.trimEnd('/')
        val url = "$baseUrl/v1/messages"
        val body = JSONObject()
            .put("model", config.model)
            .put("max_tokens", maxTokens(config))
            .put("temperature", config.temperature)
            .put("system", SYSTEM_INSTRUCTION)
            .put("messages", JSONArray()
                .put(JSONObject().put("role", "user").put("content", buildUserMessage(req))))

        val data = postJson(url, config, "anthropic", body)
        return data.optJSONArray("content")?.joinTextParts().orEmpty()
    }

    private fun requestGemini(config: SnowCompletionConfig, req: NextEditAiRequest): String {
        val baseUrl = config.state.baseUrl.trim().let {
            if (it.isNotEmpty() && it != "https://api.openai.com/v1") it.trimEnd('/')
            else "https://generativelanguage.googleapis.com/v1beta"
        }
        val modelName = config.model.let { if (it.startsWith("models/")) it else "models/$it" }
        val body = JSONObject()
            .put("contents", JSONArray().put(JSONObject()
                .put("role", "user")
                .put("parts", JSONArray().put(JSONObject().put("text", buildUserMessage(req))))))
            .put("systemInstruction", JSONObject()
                .put("parts", JSONArray().put(JSONObject().put("text", SYSTEM_INSTRUCTION))))
            .put("generationConfig", JSONObject()
                .put("maxOutputTokens", maxTokens(config))
                .put("temperature", config.temperature))

        val data = postJson("$baseUrl/$modelName:generateContent", config, "gemini", body)
        return data.optJSONArray("candidates")
            ?.optJSONObject(0)
            ?.optJSONObject("content")
            ?.optJSONArray("parts")
            ?.joinTextParts()
            .orEmpty()
    }

    private fun postJson(url: String, config: SnowCompletionConfig, provider: String?, body: JSONObject): JSONObject {
        val requestBuilder = HttpRequest.newBuilder(URI.create(url))
            .timeout(Duration.ofSeconds(90))
            .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
            .header("Content-Type", "application/json")

        val apiKey = config.apiKey
        if (apiKey.isNotBlank()) {
            when (provider) {
                "anthropic" -> {
                    requestBuilder.header("x-api-key", apiKey)
                    requestBuilder.header("anthropic-version", "2023-06-01")
                }
                "gemini" -> requestBuilder.header("x-goog-api-key", apiKey)
                else -> requestBuilder.header("Authorization", "Bearer $apiKey")
            }
        }

        val response = httpClient.send(requestBuilder.build(), HttpResponse.BodyHandlers.ofString())
        if (response.statusCode() !in 200..299) {
            throw RuntimeException("Next Edit API error ${response.statusCode()}: ${response.body().take(500)}")
        }
        return JSONObject(response.body())
    }

    private fun extractResponsesText(data: JSONObject): String {
        val outputText = data.optString("output_text", "")
        if (outputText.isNotEmpty()) return outputText
        val output = data.optJSONArray("output") ?: return ""
        val sb = StringBuilder()
        for (i in 0 until output.length()) {
            val item = output.optJSONObject(i) ?: continue
            val content = item.optJSONArray("content") ?: continue
            sb.append(content.joinTextParts())
        }
        return sb.toString()
    }

    private fun JSONArray.joinTextParts(): String {
        val sb = StringBuilder()
        for (i in 0 until length()) {
            val part = optJSONObject(i) ?: continue
            if (part.has("text")) sb.append(part.optString("text", ""))
        }
        return sb.toString()
    }

    private fun stripCodeFences(text: String): String {
        if (text.isBlank()) return ""
        var t = text.trim()
        val fenceStart = Regex("^```[a-zA-Z0-9_+-]*\\s*\\n").find(t)
        if (fenceStart != null) {
            t = t.substring(fenceStart.range.last + 1)
            val fenceEnd = t.lastIndexOf("```")
            if (fenceEnd != -1) t = t.substring(0, fenceEnd)
        }
        return t.trim()
    }

    private fun parseCandidates(raw: String): List<NextEditAiCandidate> {
        if (raw.isBlank()) return emptyList()
        val cleaned = stripCodeFences(raw)
        if (cleaned.isBlank()) return emptyList()

        val jsonArr: JSONArray = try {
            JSONArray(cleaned)
        } catch (_: JSONException) {
            val match = Regex("\\[.*]", RegexOption.DOT_MATCHES_ALL).find(cleaned)
            if (match != null) {
                try {
                    JSONArray(match.value)
                } catch (e: JSONException) {
                    logger.warn("Failed to parse Next Edit AI JSON array: ${e.message}; raw=${cleaned.take(500)}")
                    return emptyList()
                }
            } else {
                logger.warn("Next Edit AI response did not contain a JSON array; raw=${cleaned.take(500)}")
                return emptyList()
            }
        }

        val out = mutableListOf<NextEditAiCandidate>()
        for (i in 0 until jsonArr.length()) {
            val obj = jsonArr.optJSONObject(i) ?: continue
            val file = obj.optString("file", "")
            val oldText = obj.optString("oldText", "")
            val newText = obj.optString("newText", "")
            val reason = obj.optString("reason", "")
            if (file.isBlank() || oldText.isEmpty() || newText.isEmpty()) continue
            if (oldText == newText) continue
            out.add(NextEditAiCandidate(file = file, oldText = oldText, newText = newText, reason = reason))
        }
        return out
    }
}
