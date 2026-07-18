package com.snow.plugin.completion

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

@State(name = "SnowCompletionConfig", storages = [Storage("snow-completion.xml")])
@Service(Service.Level.APP)
class SnowCompletionConfig : PersistentStateComponent<SnowCompletionConfig.State> {

    data class State(
        var enabled: Boolean = false,
        var provider: String = "chat",
        var baseUrl: String = "",
        var apiKey: String = "",
        var model: String = "",
        var maxTokens: Int = 256,
        var temperature: Double = 0.2,
        var debounceMs: Int = 400,
        var contextPrefixLines: Int = 120,
        var contextSuffixLines: Int = 40,
        var languages: String = "*",
    )

    private var myState = State()

    override fun getState(): State = myState
    override fun loadState(state: State) {
        myState = state
    }

    val enabled get() = myState.enabled
    val provider get() = myState.provider
    val model get() = myState.model
    val apiKey get() = myState.apiKey
    val maxTokens get() = myState.maxTokens
    val temperature get() = myState.temperature
    val debounceMs get() = myState.debounceMs
    val contextPrefixLines get() = myState.contextPrefixLines
    val contextSuffixLines get() = myState.contextSuffixLines

    fun isLanguageEnabled(languageId: String): Boolean {
        val langs = myState.languages.trim()
        if (langs.isEmpty() || langs == "*") return true
        return langs.split(",").map { it.trim().lowercase() }.contains(languageId.lowercase())
    }

    fun resolveBaseUrl(): String {
        val custom = myState.baseUrl.trim()
        if (custom.isNotEmpty()) return custom.trimEnd('/')
        return getDefaultBaseUrl(myState.provider)
    }

    companion object {
        fun getInstance(): SnowCompletionConfig =
            ApplicationManager.getApplication().getService(SnowCompletionConfig::class.java)

        fun getDefaultBaseUrl(provider: String): String = when (provider) {
            "chat" -> "https://api.openai.com/v1"
            "fim" -> "https://api.deepseek.com/beta"
            "responses" -> "https://api.openai.com/v1"
            "gemini" -> "https://generativelanguage.googleapis.com"
            "anthropic" -> "https://api.anthropic.com"
            else -> ""
        }
    }
}
