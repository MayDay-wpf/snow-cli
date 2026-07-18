package com.snow.plugin.config

import com.intellij.openapi.options.BoundConfigurable
import com.intellij.openapi.ui.DialogPanel
import com.intellij.ui.dsl.builder.*
import com.snow.plugin.completion.SnowCompletionConfig
import com.snow.plugin.nextEdit.SnowNextEditConfig

class SnowSettingsConfigurable : BoundConfigurable(SnowBundle.message("settings.displayName")) {

    private val completionConfig = SnowCompletionConfig.getInstance()
    private val nextEditConfig = SnowNextEditConfig.getInstance()

    override fun createPanel(): DialogPanel = panel {
        group(SnowBundle.message("settings.group.completion")) {
            row("") {
                checkBox(SnowBundle.message("settings.completion.enabled"))
                    .bindSelected(completionConfig.state::enabled)
            }
            row(SnowBundle.message("settings.completion.provider")) {
                comboBox(listOf("chat", "fim", "responses", "gemini", "anthropic"))
                    .bindItem(completionConfig.state::provider.toNullableProperty())
                    .comment(SnowBundle.message("settings.completion.provider.comment"))
            }
            row(SnowBundle.message("settings.completion.baseUrl")) {
                textField()
                    .bindText(completionConfig.state::baseUrl)
                    .columns(COLUMNS_LARGE)
                    .comment(SnowBundle.message("settings.completion.baseUrl.comment"))
            }
            row(SnowBundle.message("settings.completion.apiKey")) {
                passwordField()
                    .bindText(completionConfig.state::apiKey)
                    .columns(COLUMNS_LARGE)
            }
            row(SnowBundle.message("settings.completion.model")) {
                textField()
                    .bindText(completionConfig.state::model)
                    .columns(COLUMNS_LARGE)
                    .comment(SnowBundle.message("settings.completion.model.comment"))
            }
            row(SnowBundle.message("settings.completion.maxTokens")) {
                spinner(1..8192, 64)
                    .bindIntValue(completionConfig.state::maxTokens)
            }
            row(SnowBundle.message("settings.completion.temperature")) {
                textField()
                    .bindText(
                        { completionConfig.state.temperature.toString() },
                        { completionConfig.state.temperature = it.toDoubleOrNull() ?: 0.2 },
                    )
                    .columns(6)
                    .comment(SnowBundle.message("settings.completion.temperature.comment"))
            }
            row(SnowBundle.message("settings.completion.debounceMs")) {
                spinner(50..5000, 50)
                    .bindIntValue(completionConfig.state::debounceMs)
            }
            row(SnowBundle.message("settings.completion.contextPrefixLines")) {
                spinner(1..500, 10)
                    .bindIntValue(completionConfig.state::contextPrefixLines)
            }
            row(SnowBundle.message("settings.completion.contextSuffixLines")) {
                spinner(1..500, 10)
                    .bindIntValue(completionConfig.state::contextSuffixLines)
            }
            row(SnowBundle.message("settings.completion.languages")) {
                textField()
                    .bindText(completionConfig.state::languages)
                    .columns(COLUMNS_LARGE)
                    .comment(SnowBundle.message("settings.completion.languages.comment"))
            }
        }

        group(SnowBundle.message("settings.group.nextEdit")) {
            row("") {
                checkBox(SnowBundle.message("settings.nextEdit.enabled"))
                    .bindSelected(nextEditConfig.state::enabled)
                    .comment(SnowBundle.message("settings.nextEdit.enabled.comment"))
            }
            row(SnowBundle.message("settings.nextEdit.scope")) {
                comboBox(listOf("file", "workspace"))
                    .bindItem(nextEditConfig.state::scope.toNullableProperty())
                    .comment(SnowBundle.message("settings.nextEdit.scope.comment"))
            }
            row("") {
                checkBox(SnowBundle.message("settings.nextEdit.usePsiReferences"))
                    .bindSelected(nextEditConfig.state::usePsiReferences)
                    .comment(SnowBundle.message("settings.nextEdit.usePsiReferences.comment"))
            }
            row(SnowBundle.message("settings.nextEdit.maxCandidates")) {
                spinner(1..100, 5)
                    .bindIntValue(nextEditConfig.state::maxCandidates)
            }
            row(SnowBundle.message("settings.nextEdit.minPatternLength")) {
                spinner(1..20, 1)
                    .bindIntValue(nextEditConfig.state::minPatternLength)
            }
            row(SnowBundle.message("settings.nextEdit.debounceMs")) {
                spinner(50..5000, 50)
                    .bindIntValue(nextEditConfig.state::debounceMs)
            }
        }
    }
}
