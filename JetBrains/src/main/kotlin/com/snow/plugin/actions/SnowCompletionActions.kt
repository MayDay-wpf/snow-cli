package com.snow.plugin.actions

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.snow.plugin.completion.SnowCompletionConfig
import com.snow.plugin.completion.SnowCompletionService
import com.snow.plugin.completion.SnowModelFetcher
import com.snow.plugin.config.SnowBundle

class SnowCompletionToggleAction : DumbAwareAction() {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun actionPerformed(e: AnActionEvent) {
        val config = SnowCompletionConfig.getInstance()
        config.state.enabled = !config.state.enabled
        val project = e.project
        if (project != null) {
            val msg = if (config.enabled)
                SnowBundle.message("notification.completion.enabled")
            else
                SnowBundle.message("notification.completion.disabled")
            NotificationGroupManager.getInstance()
                .getNotificationGroup("Snow CLI")
                .createNotification(msg, NotificationType.INFORMATION)
                .notify(project)
        }
    }

    override fun update(e: AnActionEvent) {
        val config = SnowCompletionConfig.getInstance()
        e.presentation.text = if (config.enabled)
            SnowBundle.message("notification.completion.disabled").removeSuffix(".")
        else
            SnowBundle.message("notification.completion.enabled").removeSuffix(".")
    }
}

class SnowCompletionTriggerAction : DumbAwareAction() {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun actionPerformed(e: AnActionEvent) {
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val config = SnowCompletionConfig.getInstance()
        if (!config.enabled) {
            e.project?.let {
                NotificationGroupManager.getInstance()
                    .getNotificationGroup("Snow CLI")
                    .createNotification(SnowBundle.message("notification.completion.disabledHint"), NotificationType.INFORMATION)
                    .notify(it)
            }
            return
        }
        SnowCompletionService.getInstance().triggerManual(editor)
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = e.getData(CommonDataKeys.EDITOR) != null
    }
}

class SnowCompletionSelectModelAction : DumbAwareAction() {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val config = SnowCompletionConfig.getInstance()

        if (config.apiKey.isBlank()) {
            NotificationGroupManager.getInstance()
                .getNotificationGroup("Snow CLI")
                .createNotification(SnowBundle.message("notification.completion.apiKeyMissing"), NotificationType.WARNING)
                .notify(project)
            return
        }

        ProgressManager.getInstance().run(object : Task.Backgroundable(project, SnowBundle.message("modelSelect.fetching"), true) {
            override fun run(indicator: ProgressIndicator) {
                try {
                    val models = SnowModelFetcher.fetchModels(config)
                    ApplicationManager.getApplication().invokeLater {
                        if (project.isDisposed) return@invokeLater
                        val items = models.map { it.id }
                        if (items.isEmpty()) {
                            NotificationGroupManager.getInstance()
                                .getNotificationGroup("Snow CLI")
                                .createNotification(SnowBundle.message("notification.completion.noModels"), NotificationType.WARNING)
                                .notify(project)
                            return@invokeLater
                        }

                        JBPopupFactory.getInstance()
                            .createPopupChooserBuilder(items)
                            .setTitle(SnowBundle.message("modelSelect.title", config.provider))
                            .setItemChosenCallback { chosen ->
                                config.state.model = chosen
                                NotificationGroupManager.getInstance()
                                    .getNotificationGroup("Snow CLI")
                                    .createNotification(SnowBundle.message("notification.completion.modelSet", chosen), NotificationType.INFORMATION)
                                    .notify(project)
                            }
                            .createPopup()
                            .showCenteredInCurrentWindow(project)
                    }
                } catch (ex: Exception) {
                    ApplicationManager.getApplication().invokeLater {
                        NotificationGroupManager.getInstance()
                            .getNotificationGroup("Snow CLI")
                            .createNotification(SnowBundle.message("notification.completion.modelFetchFailed", ex.message ?: ""), NotificationType.ERROR)
                            .notify(project)
                    }
                }
            }
        })
    }
}
