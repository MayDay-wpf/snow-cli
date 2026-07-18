package com.snow.plugin.completion

import com.intellij.openapi.diagnostic.Logger
import org.json.JSONObject
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

data class ModelEntry(
    val id: String,
    val label: String? = null,
    val description: String? = null,
)

object SnowModelFetcher {
    private val logger = Logger.getInstance(SnowModelFetcher::class.java)
    private val httpClient: HttpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(15))
        .build()

    fun fetchModels(config: SnowCompletionConfig): List<ModelEntry> {
        return when (config.provider) {
            "chat", "fim", "responses" -> fetchOpenAIModels(config)
            "anthropic" -> fetchAnthropicModels(config)
            "gemini" -> fetchGeminiModels(config)
            else -> emptyList()
        }
    }

    private fun fetchOpenAIModels(config: SnowCompletionConfig): List<ModelEntry> {
        val url = "${config.resolveBaseUrl()}/models"
        val request = HttpRequest.newBuilder(URI.create(url))
            .timeout(Duration.ofSeconds(15))
            .GET()
            .header("Authorization", "Bearer ${config.apiKey}")
            .build()

        val response = httpClient.send(request, HttpResponse.BodyHandlers.ofString())
        if (response.statusCode() !in 200..299) {
            throw RuntimeException("Failed to fetch models: ${response.statusCode()}")
        }

        val json = JSONObject(response.body())
        val data = json.optJSONArray("data") ?: return emptyList()
        val models = mutableListOf<ModelEntry>()
        for (i in 0 until data.length()) {
            val model = data.optJSONObject(i) ?: continue
            val id = model.optString("id", "")
            if (id.isNotEmpty()) models.add(ModelEntry(id))
        }
        return models.sortedBy { it.id }
    }

    private fun fetchAnthropicModels(config: SnowCompletionConfig): List<ModelEntry> {
        val baseUrl = config.state.baseUrl.trim().ifEmpty { "https://api.anthropic.com" }.trimEnd('/')
        return try {
            val url = "$baseUrl/v1/models"
            val request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(15))
                .GET()
                .header("x-api-key", config.apiKey)
                .header("anthropic-version", "2023-06-01")
                .build()

            val response = httpClient.send(request, HttpResponse.BodyHandlers.ofString())
            if (response.statusCode() !in 200..299) throw RuntimeException("${response.statusCode()}")

            val json = JSONObject(response.body())
            val data = json.optJSONArray("data") ?: return fallbackAnthropicModels()
            val models = mutableListOf<ModelEntry>()
            for (i in 0 until data.length()) {
                val m = data.optJSONObject(i) ?: continue
                val id = m.optString("id", "")
                if (id.isNotEmpty()) models.add(ModelEntry(id, m.optString("display_name", null)))
            }
            models.sortedBy { it.id }
        } catch (e: Exception) {
            logger.info("Anthropic model list failed, using fallback: ${e.message}")
            fallbackAnthropicModels()
        }
    }

    private fun fallbackAnthropicModels(): List<ModelEntry> = listOf(
        "claude-opus-4-5", "claude-opus-4-1", "claude-sonnet-4-5",
        "claude-sonnet-4", "claude-3-7-sonnet-latest",
        "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest",
    ).map { ModelEntry(it) }

    private fun fetchGeminiModels(config: SnowCompletionConfig): List<ModelEntry> {
        val baseUrl = config.state.baseUrl.trim().let {
            if (it.isNotEmpty() && it != "https://api.openai.com/v1") it.trimEnd('/')
            else "https://generativelanguage.googleapis.com/v1beta"
        }
        val url = "$baseUrl/models?key=${config.apiKey}"
        val request = HttpRequest.newBuilder(URI.create(url))
            .timeout(Duration.ofSeconds(15))
            .GET()
            .build()

        val response = httpClient.send(request, HttpResponse.BodyHandlers.ofString())
        if (response.statusCode() !in 200..299) {
            throw RuntimeException("Failed to fetch Gemini models: ${response.statusCode()}")
        }

        val json = JSONObject(response.body())
        val data = json.optJSONArray("models") ?: return emptyList()
        val models = mutableListOf<ModelEntry>()
        for (i in 0 until data.length()) {
            val m = data.optJSONObject(i) ?: continue
            val name = m.optString("name", "")
            if (name.isEmpty()) continue
            val id = if (name.startsWith("models/")) name.removePrefix("models/") else name
            models.add(ModelEntry(id, m.optString("displayName", null), m.optString("description", null)))
        }
        return models.sortedBy { it.id }
    }
}
