package com.snow.plugin.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.snow.plugin.SnowWebSocketManager
import com.snow.plugin.util.TerminalCompat

class OpenSnowTerminalAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return

        ApplicationManager.getApplication().invokeLater {
            try {
                TerminalCompat.openTerminalWithCommand(project, project.basePath, "Snow CLI", "snow")
            } catch (_: Exception) {
            }
        }

        val wsManager = SnowWebSocketManager.instance
        ApplicationManager.getApplication().executeOnPooledThread {
            Thread.sleep(500)
            wsManager.connect()
        }
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = e.project != null
    }
}
