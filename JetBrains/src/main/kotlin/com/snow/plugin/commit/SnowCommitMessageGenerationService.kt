package com.snow.plugin.commit

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.ide.ActivityTracker
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.progress.ProcessCanceledException
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.vcs.CommitMessageI
import com.intellij.vcs.commit.CommitMessageUi
import com.snow.plugin.config.SnowBundle
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.min

private const val MAX_DIFF_CHARS = 120_000
private const val API_MAX_RETRIES = 5
private const val API_RETRY_BASE_DELAY_MS = 1_000L
private val RESTRICTED_HEADERS = setOf(
    "connection",
    "content-length",
    "date",
    "expect",
    "from",
    "host",
    "upgrade",
    "via",
    "warning",
)

@Service(Service.Level.PROJECT)
class SnowCommitMessageGenerationService(private val project: Project) {
    private val logger = Logger.getInstance(SnowCommitMessageGenerationService::class.java)
    private val generating = AtomicBoolean(false)
    private val httpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(30))
        .build()

    @Volatile
    private var activeIndicator: ProgressIndicator? = null

    fun isGenerating(): Boolean = generating.get()

    fun generate(
        commitMessageControl: CommitMessageI?,
        commitMessageUi: CommitMessageUi?,
        additionalRequirements: String? = null,
    ) {
        if (!generating.compareAndSet(false, true)) {
            activeIndicator?.cancel()
            return
        }
        updateActions()

        ProgressManager.getInstance().run(object : Task.Backgroundable(project, SnowBundle.message("commitMessage.generating"), true) {
            private var generatedMessage: String? = null

            override fun run(indicator: ProgressIndicator) {
                activeIndicator = indicator
                ApplicationManager.getApplication().invokeLater {
                    commitMessageUi?.startLoading()
                }

                val payload = collectDiffPayload(indicator)
                if (payload.diff.isBlank()) {
                    notify(SnowBundle.message("commitMessage.noChanges"), NotificationType.INFORMATION)
                    return
                }

                generatedMessage = normalizeCommitMessage(requestCommitMessage(payload, indicator, additionalRequirements))
            }

            override fun onSuccess() {
                val message = generatedMessage ?: return
                if (commitMessageControl != null) {
                    commitMessageControl.setCommitMessage(message)
                } else {
                    commitMessageUi?.setText(message)
                }
                commitMessageUi?.focus()
            }

            override fun onCancel() {
                notify(SnowBundle.message("commitMessage.stopped"), NotificationType.INFORMATION)
            }

            override fun onThrowable(error: Throwable) {
                if (error is ProcessCanceledException) {
                    return
                }
                logger.warn("Failed to generate commit message", error)
                notify(
                    SnowBundle.message("commitMessage.failed", error.message ?: error.javaClass.simpleName),
                    NotificationType.ERROR,
                )
            }

            override fun onFinished() {
                commitMessageUi?.stopLoading()
                activeIndicator = null
                generating.set(false)
                updateActions()
            }
        })
    }

    private fun updateActions() {
        ApplicationManager.getApplication().invokeLater {
            ActivityTracker.getInstance().inc()
        }
    }

    private fun collectDiffPayload(indicator: ProgressIndicator): DiffPayload {
        val repositoryRoot = findGitRoot(indicator)
        val stagedDiff = execGit(listOf("diff", "--cached", "--no-ext-diff"), repositoryRoot, indicator)
        val hasStagedChanges = stagedDiff.trim().isNotEmpty()
        val fullDiff = if (hasStagedChanges) {
            stagedDiff
        } else {
            execGit(listOf("diff", "--no-ext-diff"), repositoryRoot, indicator)
        }
        val truncated = fullDiff.length > MAX_DIFF_CHARS

        return DiffPayload(
            diff = if (truncated) fullDiff.take(MAX_DIFF_CHARS) else fullDiff,
            source = if (hasStagedChanges) DiffSource.STAGED else DiffSource.WORKING_TREE,
            truncated = truncated,
        )
    }

    private fun findGitRoot(indicator: ProgressIndicator): String {
        val projectRoot = project.basePath ?: throw IllegalStateException("Project path is not available.")
        return try {
            execGit(listOf("rev-parse", "--show-toplevel"), projectRoot, indicator).trim().ifEmpty { projectRoot }
        } catch (_: Exception) {
            projectRoot
        }
    }

    private fun execGit(args: List<String>, cwd: String, indicator: ProgressIndicator): String {
        indicator.checkCanceled()
        val process = ProcessBuilder(listOf("git") + args)
            .directory(File(cwd))
            .redirectErrorStream(true)
            .start()

        val output = StringBuilder()
        val readerThread = Thread {
            process.inputStream.bufferedReader().use { reader ->
                output.append(reader.readText())
            }
        }.apply {
            name = "Snow Git Output Reader"
            isDaemon = true
            start()
        }

        try {
            while (!process.waitFor(100, TimeUnit.MILLISECONDS)) {
                indicator.checkCanceled()
            }
            readerThread.join(1_000)
        } catch (error: ProcessCanceledException) {
            process.destroyForcibly()
            throw error
        }

        val text = output.toString()
        if (process.exitValue() != 0) {
            throw IllegalStateException(text.trim().ifEmpty { "git ${args.joinToString(" ")} failed." })
        }
        return text
    }

    private fun requestCommitMessage(
        payload: DiffPayload,
        indicator: ProgressIndicator,
        additionalRequirements: String?,
    ): String {
        val config = loadActiveSnowConfig()
        val model = config.basicModel.trim()
        if (model.isEmpty()) {
            throw IllegalStateException("Basic model is not configured.")
        }

        val prompt = buildPrompt(payload, additionalRequirements)
        return withApiRetry(indicator) {
            when (config.requestMethod.ifBlank { "chat" }) {
                "responses" -> requestResponsesCommitMessage(config, model, prompt, indicator)
                "gemini" -> requestGeminiCommitMessage(config, model, prompt, indicator)
                "anthropic" -> requestAnthropicCommitMessage(config, model, prompt, indicator)
                else -> requestChatCommitMessage(config, model, prompt, indicator)
            }
        }
    }

    private fun requestChatCommitMessage(
        config: SnowApiConfig,
        model: String,
        prompt: CommitPrompt,
        indicator: ProgressIndicator,
    ): String {
        val url = "${requireBaseUrl(config)}/chat/completions"
        val body = JSONObject()
            .put("model", model)
            .put(
                "messages",
                JSONArray()
                    .put(JSONObject().put("role", "system").put("content", prompt.system))
                    .put(JSONObject().put("role", "user").put("content", prompt.user)),
            )
            .put("stream", false)
            .put("temperature", 0.2)

        val data = postJson(url, config, null, body, indicator, "OpenAI Chat API")
        return data.optJSONArray("choices")
            ?.optJSONObject(0)
            ?.optJSONObject("message")
            ?.optString("content")
            .orEmpty()
    }

    private fun requestResponsesCommitMessage(
        config: SnowApiConfig,
        model: String,
        prompt: CommitPrompt,
        indicator: ProgressIndicator,
    ): String {
        val url = "${requireBaseUrl(config)}/responses"
        val body = JSONObject()
            .put("model", model)
            .put("instructions", prompt.system)
            .put("input", prompt.user)
            .put("store", false)

        val data = postJson(url, config, null, body, indicator, "OpenAI Responses API")
        return extractResponsesText(data)
    }

    private fun requestGeminiCommitMessage(
        config: SnowApiConfig,
        model: String,
        prompt: CommitPrompt,
        indicator: ProgressIndicator,
    ): String {
        val baseUrl = if (config.baseUrl.isNotBlank() && config.baseUrl != "https://api.openai.com/v1") {
            trimTrailingSlash(config.baseUrl)
        } else {
            "https://generativelanguage.googleapis.com/v1beta"
        }
        val modelName = if (model.startsWith("models/")) model else "models/$model"
        val body = JSONObject()
            .put(
                "contents",
                JSONArray().put(
                    JSONObject()
                        .put("role", "user")
                        .put("parts", JSONArray().put(JSONObject().put("text", "${prompt.system}\n\n${prompt.user}"))),
                ),
            )
            .put(
                "generationConfig",
                JSONObject()
                    .put("temperature", 0.2),
            )

        val data = postJson("$baseUrl/$modelName:generateContent", config, "gemini", body, indicator, "Gemini API")
        return data.optJSONArray("candidates")
            ?.optJSONObject(0)
            ?.optJSONObject("content")
            ?.optJSONArray("parts")
            ?.joinTextParts()
            .orEmpty()
    }

    private fun requestAnthropicCommitMessage(
        config: SnowApiConfig,
        model: String,
        prompt: CommitPrompt,
        indicator: ProgressIndicator,
    ): String {
        val baseUrl = if (config.baseUrl.isNotBlank() && config.baseUrl != "https://api.openai.com/v1") {
            trimTrailingSlash(config.baseUrl)
        } else {
            "https://api.anthropic.com/v1"
        }
        val body = JSONObject()
            .put("model", model)
            .put("max_tokens", 4_096)
            .put("temperature", 0.2)
            .put("system", prompt.system)
            .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", prompt.user)))

        val data = postJson("$baseUrl/messages", config, "anthropic", body, indicator, "Anthropic API")
        return data.optJSONArray("content")?.joinTextParts().orEmpty()
    }

    private fun postJson(
        url: String,
        config: SnowApiConfig,
        provider: String?,
        body: JSONObject,
        indicator: ProgressIndicator,
        apiName: String,
    ): JSONObject {
        indicator.checkCanceled()
        val requestBuilder = HttpRequest.newBuilder(URI.create(url))
            .timeout(Duration.ofSeconds(config.streamIdleTimeoutSec?.coerceAtLeast(1) ?: 120))
            .POST(HttpRequest.BodyPublishers.ofString(body.toString()))

        buildHeaders(config, provider).forEach { (key, value) ->
            if (isRestrictedHeader(key)) {
                logger.warn("Skip restricted header: $key")
                return@forEach
            }
            requestBuilder.header(key, value)
        }

        val response = httpClient.send(requestBuilder.build(), HttpResponse.BodyHandlers.ofString())
        indicator.checkCanceled()

        if (response.statusCode() !in 200..299) {
            throw ApiRequestException(
                "$apiName error: ${response.statusCode()} - ${response.body()}",
                response.statusCode(),
                response.body(),
            )
        }

        return JSONObject(response.body())
    }

    private fun buildHeaders(config: SnowApiConfig, provider: String?): Map<String, String> {
        val headers = linkedMapOf<String, String>()
        headers["Content-Type"] = "application/json"
        headers.putAll(loadCustomHeaders(config))

        if (config.apiKey.isNotBlank()) {
            headers["Authorization"] = "Bearer ${config.apiKey}"
        }
        if (provider == "gemini" && config.apiKey.isNotBlank()) {
            headers["x-goog-api-key"] = config.apiKey
        }
        if (provider == "anthropic") {
            if (config.apiKey.isNotBlank()) {
                headers["x-api-key"] = config.apiKey
            }
            if (headers.keys.none { it.equals("anthropic-version", ignoreCase = true) }) {
                headers["anthropic-version"] = "2023-06-01"
            }
        }
        return headers
    }

    private fun isRestrictedHeader(name: String): Boolean {
        val lower = name.lowercase()
        return lower in RESTRICTED_HEADERS
    }


    private fun loadActiveSnowConfig(): SnowApiConfig {
        val configDir = File(System.getProperty("user.home"), ".snow")
        val activeProfile = getActiveProfileName(configDir)
        val profilePath = File(File(configDir, "profiles"), "$activeProfile.json")
        val appConfig = readJsonFile(profilePath) ?: readJsonFile(File(configDir, "config.json"))
        val snowConfig = appConfig?.optJSONObject("snowcfg")
            ?: throw IllegalStateException("Snow configuration not found.")

        return SnowApiConfig(
            baseUrl = snowConfig.optString("baseUrl", "").trim(),
            apiKey = snowConfig.optString("apiKey", ""),
            requestMethod = snowConfig.optString("requestMethod", "chat"),
            basicModel = snowConfig.optString("basicModel", "").trim(),
            streamIdleTimeoutSec = if (snowConfig.has("streamIdleTimeoutSec")) snowConfig.optLong("streamIdleTimeoutSec") else null,
            customHeadersSchemeId = if (snowConfig.has("customHeadersSchemeId") && !snowConfig.isNull("customHeadersSchemeId")) {
                snowConfig.optString("customHeadersSchemeId")
            } else {
                null
            },
        )
    }

    private fun getActiveProfileName(configDir: File): String {
        val activeProfile = readJsonFile(File(configDir, "active-profile.json"))?.optString("activeProfile", "")
        if (!activeProfile.isNullOrBlank()) {
            return activeProfile
        }

        val legacyActiveProfile = File(configDir, "active-profile.txt")
        if (legacyActiveProfile.exists()) {
            return legacyActiveProfile.readText().trim().ifEmpty { "default" }
        }

        return "default"
    }

    private fun readJsonFile(file: File): JSONObject? {
        if (!file.exists()) {
            return null
        }
        return try {
            JSONObject(file.readText())
        } catch (_: Exception) {
            null
        }
    }

    private fun loadCustomHeaders(config: SnowApiConfig): Map<String, String> {
        val customHeadersConfig = readJsonFile(File(File(System.getProperty("user.home"), ".snow"), "custom-headers.json"))
            ?: return emptyMap()
        val schemeId = config.customHeadersSchemeId ?: customHeadersConfig.optString("active", "")
        if (schemeId.isBlank()) {
            return emptyMap()
        }

        val schemes = customHeadersConfig.optJSONArray("schemes") ?: return emptyMap()
        for (index in 0 until schemes.length()) {
            val scheme = schemes.optJSONObject(index) ?: continue
            if (scheme.optString("id", "") != schemeId) {
                continue
            }
            val headersObject = scheme.optJSONObject("headers") ?: return emptyMap()
            val headers = linkedMapOf<String, String>()
            val keys = headersObject.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                headers[key] = headersObject.optString(key, "")
            }
            return headers
        }

        return emptyMap()
    }

    private fun buildPrompt(payload: DiffPayload, additionalRequirements: String?): CommitPrompt {
        val sourceLabel = if (payload.source == DiffSource.STAGED) "staged" else "working tree"
        val truncatedNotice = if (payload.truncated) "\n\nNote: The diff was truncated because it is large." else ""
        val requirementNotice = additionalRequirements?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?.let { "\n\nAdditional requirements from the user:\n$it" }
            .orEmpty()

        return CommitPrompt(
            system = listOf(
                "You generate clear Git commit messages.",
                "Return only the final commit message, with no markdown, no quotes, and no explanation.",
                "Use an appropriate level of detail for the changes; include a body when it helps explain important context.",
                "Prefer Conventional Commit style when it fits, for example: feat: add login validation.",
            ).joinToString(" "),
            user = "Generate one commit message for the $sourceLabel changes below.$truncatedNotice$requirementNotice\n\n${payload.diff}",
        )
    }

    private fun normalizeCommitMessage(message: String): String {
        val normalized = message
            .trim()
            .replace(Regex("^```(?:[\\w-]+)?\\s*"), "")
            .replace(Regex("```$"), "")
            .trim()
            .replace(Regex("^[\\\"']|[\\\"']$"), "")
            .replace(Regex("^commit message:\\s*", RegexOption.IGNORE_CASE), "")
            .trim()

        if (normalized.isEmpty()) {
            throw IllegalStateException("The model returned an empty commit message.")
        }
        return normalized
    }

    private fun extractResponsesText(data: JSONObject): String {
        val outputText = data.optString("output_text", "")
        if (outputText.isNotEmpty()) {
            return outputText
        }

        val output = data.optJSONArray("output") ?: return ""
        val result = StringBuilder()
        for (index in 0 until output.length()) {
            val item = output.optJSONObject(index) ?: continue
            val content = item.optJSONArray("content") ?: continue
            result.append(content.joinTextParts())
        }
        return result.toString()
    }

    private fun JSONArray.joinTextParts(): String {
        val result = StringBuilder()
        for (index in 0 until length()) {
            val part = optJSONObject(index) ?: continue
            if (part.has("text")) {
                result.append(part.optString("text", ""))
            }
        }
        return result.toString()
    }

    private fun <T> withApiRetry(indicator: ProgressIndicator, request: () -> T): T {
        var lastError: Throwable? = null
        for (attempt in 0..API_MAX_RETRIES) {
            indicator.checkCanceled()
            try {
                return request()
            } catch (error: ProcessCanceledException) {
                throw error
            } catch (error: Throwable) {
                lastError = error
                if (!isRetriableApiError(error) || attempt >= API_MAX_RETRIES) {
                    throw error
                }
                delay(API_RETRY_BASE_DELAY_MS * (1L shl attempt), indicator)
            }
        }
        throw lastError ?: IllegalStateException("Commit message request failed.")
    }

    private fun isRetriableApiError(error: Throwable): Boolean {
        if (error is ApiRequestException) {
            return error.status == 429 || error.status >= 500
        }

        val message = error.message?.lowercase().orEmpty()
        return listOf(
            "network",
            "econnrefused",
            "econnreset",
            "etimedout",
            "timeout",
            "rate limit",
            "too many requests",
            "service unavailable",
            "temporarily unavailable",
            "bad gateway",
            "gateway timeout",
            "internal server error",
        ).any { message.contains(it) }
    }

    private fun delay(ms: Long, indicator: ProgressIndicator) {
        var remaining = ms
        while (remaining > 0) {
            indicator.checkCanceled()
            val step = min(remaining, 100L)
            Thread.sleep(step)
            remaining -= step
        }
    }

    private fun requireBaseUrl(config: SnowApiConfig): String {
        if (config.baseUrl.isBlank()) {
            throw IllegalStateException("Base URL is not configured.")
        }
        return trimTrailingSlash(config.baseUrl)
    }

    private fun trimTrailingSlash(value: String): String = value.replace(Regex("/+$"), "")

    private fun notify(message: String, type: NotificationType) {
        ApplicationManager.getApplication().invokeLater {
            NotificationGroupManager.getInstance()
                .getNotificationGroup("Snow CLI")
                .createNotification(message, type)
                .notify(project)
        }
    }
}

private data class DiffPayload(
    val diff: String,
    val source: DiffSource,
    val truncated: Boolean,
)

private enum class DiffSource {
    STAGED,
    WORKING_TREE,
}

private data class CommitPrompt(
    val system: String,
    val user: String,
)

private data class SnowApiConfig(
    val baseUrl: String,
    val apiKey: String,
    val requestMethod: String,
    val basicModel: String,
    val streamIdleTimeoutSec: Long?,
    val customHeadersSchemeId: String?,
)

private class ApiRequestException(
    message: String,
    val status: Int,
    val responseText: String,
) : RuntimeException(message)
