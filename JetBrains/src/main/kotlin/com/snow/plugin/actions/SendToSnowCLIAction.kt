package com.snow.plugin.actions

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.DumbAwareAction
import com.snow.plugin.SnowWebSocketManager
import com.snow.plugin.util.TerminalCompat

class SendToSnowCLIAction : DumbAwareAction() {

    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val files = e.getData(CommonDataKeys.VIRTUAL_FILE_ARRAY)
            ?: e.getData(CommonDataKeys.VIRTUAL_FILE)?.let { arrayOf(it) }
            ?: return
        if (files.isEmpty()) return

        val formattedPaths = files.joinToString(" ") { "\"${it.path}\"" }

        ApplicationManager.getApplication().invokeLater {
            val sent = TerminalCompat.sendTextToNamedTerminal(project, "Snow CLI", formattedPaths)
            if (!sent) {
                TerminalCompat.openTerminalWithCommand(project, project.basePath, "Snow CLI", "snow")
                ApplicationManager.getApplication().executeOnPooledThread {
                    Thread.sleep(3000)
                    ApplicationManager.getApplication().invokeLater {
                        TerminalCompat.sendTextToNamedTerminal(project, "Snow CLI", formattedPaths)
                    }
                }
                val wsManager = SnowWebSocketManager.instance
                ApplicationManager.getApplication().executeOnPooledThread {
                    Thread.sleep(500)
                    wsManager.connect()
                }
            }
        }
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isVisible = true
        e.presentation.isEnabled = e.project != null
    }
}
