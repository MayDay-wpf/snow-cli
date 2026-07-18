package com.snow.plugin.actions

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.project.DumbAwareAction
import com.snow.plugin.config.SnowBundle
import com.snow.plugin.nextEdit.SnowNextEditConfig
import com.snow.plugin.nextEdit.SnowNextEditEngine

class SnowNextEditToggleAction : DumbAwareAction() {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun actionPerformed(e: AnActionEvent) {
        val config = SnowNextEditConfig.getInstance()
        config.state.enabled = !config.state.enabled
        val project = e.project
        if (project != null) {
            if (!config.enabled) {
                SnowNextEditEngine.getInstance(project).dismiss("disabled")
            }
            val msg = if (config.enabled)
                SnowBundle.message("notification.nextEdit.enabled")
            else
                SnowBundle.message("notification.nextEdit.disabled")
            NotificationGroupManager.getInstance()
                .getNotificationGroup("Snow CLI")
                .createNotification(msg, NotificationType.INFORMATION)
                .notify(project)
        }
    }

    override fun update(e: AnActionEvent) {
        val config = SnowNextEditConfig.getInstance()
        e.presentation.text = if (config.enabled)
            SnowBundle.message("notification.nextEdit.disabled").removeSuffix(".")
        else
            SnowBundle.message("notification.nextEdit.enabled").removeSuffix(".")
        e.presentation.isEnabled = e.project != null
    }
}

class SnowNextEditTriggerAction : DumbAwareAction() {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val config = SnowNextEditConfig.getInstance()
        if (!config.enabled) {
            NotificationGroupManager.getInstance()
                .getNotificationGroup("Snow CLI")
                .createNotification(SnowBundle.message("notification.nextEdit.disabledHint"), NotificationType.INFORMATION)
                .notify(project)
            return
        }
        SnowNextEditEngine.getInstance(project).triggerManual(editor)
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = e.project != null && e.getData(CommonDataKeys.EDITOR) != null
    }
}

class SnowNextEditDismissAction : DumbAwareAction() {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        SnowNextEditEngine.getInstance(project).dismiss()
    }

    override fun update(e: AnActionEvent) {
        val project = e.project ?: return
        e.presentation.isEnabled = SnowNextEditEngine.getInstance(project).hasSession()
    }
}

class SnowNextEditNextAction : DumbAwareAction() {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        SnowNextEditEngine.getInstance(project).next()
    }

    override fun update(e: AnActionEvent) {
        val project = e.project ?: return
        e.presentation.isEnabled = SnowNextEditEngine.getInstance(project).hasSession()
    }
}
