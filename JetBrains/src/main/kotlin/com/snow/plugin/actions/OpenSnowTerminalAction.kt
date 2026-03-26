package com.snow.plugin.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.snow.plugin.SnowWebSocketManager
import org.jetbrains.plugins.terminal.TerminalToolWindowManager

/**
 * Action to open Snow CLI in terminal
 */
class OpenSnowTerminalAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return

        // Use Terminal API to send command directly
        ApplicationManager.getApplication().invokeLater {
            try {
                val terminalManager = TerminalToolWindowManager.getInstance(project)

                // Create new terminal session with activateTool=true to show the terminal window
                val widget = terminalManager.createShellWidget(project.basePath, "Snow CLI", true, true)

                ApplicationManager.getApplication().executeOnPooledThread {
                    try {
                        Thread.sleep(1000)

                        ApplicationManager.getApplication().invokeLater {
                            try {
                                widget.sendCommandToExecute("snow")
                            } catch (ex: Exception) {
                                // Silently handle command execution failure
                            }
                        }
                    } catch (ex: Exception) {
                        // Silently handle background thread failure
                    }
                }
            } catch (ex: Exception) {
                // Silently handle terminal access failure
            }
        }

        // Ensure WebSocket server is running
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

