package com.snow.plugin.completion

import com.intellij.openapi.diagnostic.Logger
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

data class CompletionRequest(
    val prefix: String,
    val suffix: String,
    val languageId: String,
    val fileName: String,
)

data class CompletionResult(
    val text: String,
    val raw: String = "",
)

private val SYSTEM_INSTRUCTION = listOf(
    "You are a code completion engine inside an IDE.",
    "You will be given two segments: <PREFIX> (code before the cursor) and <SUFFIX> (code after the cursor).",
    "Your only task: output the code that fills the gap between PREFIX and SUFFIX so the file becomes syntactically and logically correct.",
    "Hard rules:",
    "1. Output raw code only. No prose, no explanations, no markdown fences.",
    "2. Do not repeat any character of PREFIX or SUFFIX.",
    "3. Continue exactly from where PREFIX ends. The first character you emit will be appended right after PREFIX.",
    "4. Preserve the existing language, indentation and style.",
    "5. Always produce code. If the cursor is at a blank/empty spot, generate the most likely next statement(s). Never refuse and never return an empty response.",
).joinToString("\n")

object SnowCompletionClient {
    private val logger = Logger.getInstance(SnowCompletionClient::class.java)
    private val httpClient: HttpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(30))
        .build()

    fun requestCompletion(config: SnowCompletionConfig, req: CompletionRequest): CompletionResult {
        return when (config.provider) {
            "chat" -> requestChat(config, req)
            "fim" -> requestFim(config, req)
            "responses" -> requestResponses(config, req)
            "anthropic" -> requestAnthropic(config, req)
            "gemini" -> requestGemini(config, req)
            else -> throw IllegalArgumentException("Unknown completion provider: ${config.provider}")
        }
    }

    private fun buildUserMessage(req: CompletionRequest): String = buildString {
        appendLine("Language: ${req.languageId}")
        appendLine("File: ${req.fileName}")
        appendLine()
        appendLine("<PREFIX>")
        append(req.prefix)
        appendLine()
        appendLine("</PREFIX>")
        appendLine("<SUFFIX>")
        append(req.suffix)
        appendLine()
        appendLine("</SUFFIX>")
        appendLine()
        append("Write the code that goes at the cursor between PREFIX and SUFFIX. Output the code only.")
    }

    private fun requestChat(config: SnowCompletionConfig, req: CompletionRequest): CompletionResult {
        val url = "${config.resolveBaseUrl()}/chat/completions"
        val body = JSONObject()
            .put("model", config.model)
            .put("temperature", config.temperature)
            .put("max_tokens", config.maxTokens)
            .put("messages", JSONArray()
                .put(JSONObject().put("role", "system").put("content", SYSTEM_INSTRUCTION))
                .put(JSONObject().put("role", "user").put("content", buildUserMessage(req))))

        val data = postJson(url, config, null, body)
        val raw = data.optJSONArray("choices")
            ?.optJSONObject(0)
            ?.optJSONObject("message")
            ?.optString("content", "")
            .orEmpty()
        return CompletionResult(text = postProcess(raw, req.prefix, req.suffix), raw = raw)
    }

    private fun requestFim(config: SnowCompletionConfig, req: CompletionRequest): CompletionResult {
        val url = "${config.resolveBaseUrl()}/completions"
        val body = JSONObject()
            .put("model", config.model)
            .put("prompt", req.prefix)
            .put("temperature", config.temperature)
            .put("max_tokens", config.maxTokens)
        if (req.suffix.isNotEmpty()) {
            body.put("suffix", req.suffix)
        }

        val data = postJson(url, config, null, body)
        val raw = data.optJSONArray("choices")
            ?.optJSONObject(0)
            ?.optString("text", "")
            .orEmpty()
        return CompletionResult(text = postProcess(raw, req.prefix, req.suffix), raw = raw)
    }

    private fun requestResponses(config: SnowCompletionConfig, req: CompletionRequest): CompletionResult {
        val url = "${config.resolveBaseUrl()}/responses"
        val body = JSONObject()
            .put("model", config.model)
            .put("max_output_tokens", config.maxTokens)
            .put("temperature", config.temperature)
            .put("input", JSONArray()
                .put(JSONObject().put("role", "system")
                    .put("content", JSONArray().put(JSONObject().put("type", "input_text").put("text", SYSTEM_INSTRUCTION))))
                .put(JSONObject().put("role", "user")
                    .put("content", JSONArray().put(JSONObject().put("type", "input_text").put("text", buildUserMessage(req))))))

        val data = postJson(url, config, null, body)
        val raw = extractResponsesText(data)
        return CompletionResult(text = postProcess(raw, req.prefix, req.suffix), raw = raw)
    }

    private fun requestAnthropic(config: SnowCompletionConfig, req: CompletionRequest): CompletionResult {
        val baseUrl = config.state.baseUrl.trim().ifEmpty { "https://api.anthropic.com" }.trimEnd('/')
        val url = "$baseUrl/v1/messages"
        val body = JSONObject()
            .put("model", config.model)
            .put("max_tokens", config.maxTokens)
            .put("temperature", config.temperature)
            .put("system", SYSTEM_INSTRUCTION)
            .put("messages", JSONArray()
                .put(JSONObject().put("role", "user").put("content", buildUserMessage(req)))
                .put(JSONObject().put("role", "assistant").put("content", "<COMPLETION>")))
            .put("stop_sequences", JSONArray().put("</COMPLETION>"))

        val data = postJson(url, config, "anthropic", body)
        var raw = data.optJSONArray("content")?.joinTextParts().orEmpty()
        raw = raw.removePrefix("<COMPLETION>").removeSuffix("</COMPLETION>").trim()
        return CompletionResult(text = postProcess(raw, req.prefix, req.suffix), raw = raw)
    }

    private fun requestGemini(config: SnowCompletionConfig, req: CompletionRequest): CompletionResult {
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
                .put("maxOutputTokens", config.maxTokens)
                .put("temperature", config.temperature))

        val data = postJson("$baseUrl/$modelName:generateContent", config, "gemini", body)
        val raw = data.optJSONArray("candidates")
            ?.optJSONObject(0)
            ?.optJSONObject("content")
            ?.optJSONArray("parts")
            ?.joinTextParts()
            .orEmpty()
        return CompletionResult(text = postProcess(raw, req.prefix, req.suffix), raw = raw)
    }

    private fun postJson(url: String, config: SnowCompletionConfig, provider: String?, body: JSONObject): JSONObject {
        val requestBuilder = HttpRequest.newBuilder(URI.create(url))
            .timeout(Duration.ofSeconds(60))
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
            throw RuntimeException("API error ${response.statusCode()}: ${response.body().take(500)}")
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

    private fun postProcess(text: String, prefix: String, suffix: String): String {
        var out = stripCodeFences(text)
        out = trimPrefixOverlap(out, prefix)
        out = trimSuffixOverlap(out, suffix)
        return out
    }

    private fun stripCodeFences(text: String): String {
        if (text.isBlank()) return ""
        var t = text
        val fenceStart = Regex("^\\s*```[a-zA-Z0-9_+-]*\\s*\\n").find(t)
        if (fenceStart != null) {
            t = t.substring(fenceStart.range.last + 1)
            val fenceEnd = t.lastIndexOf("```")
            if (fenceEnd != -1) t = t.substring(0, fenceEnd)
        }
        return t
    }

    private fun trimPrefixOverlap(completion: String, prefix: String): String {
        if (completion.isEmpty()) return completion
        for (len in listOf(400, 200, 80, 30)) {
            if (prefix.length < len) continue
            val tail = prefix.takeLast(len)
            if (completion.startsWith(tail)) return completion.substring(tail.length)
        }
        return completion
    }

    private fun trimSuffixOverlap(completion: String, suffix: String): String {
        if (completion.isEmpty() || suffix.isEmpty()) return completion
        for (len in listOf(400, 200, 80, 30)) {
            if (suffix.length < len) continue
            val head = suffix.take(len)
            if (completion.endsWith(head)) return completion.substring(0, completion.length - head.length)
        }
        return completion
    }
}
