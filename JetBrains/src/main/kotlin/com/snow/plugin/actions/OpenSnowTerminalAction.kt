package com.snow.plugin.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.snow.plugin.SnowWebSocketManager
import icons.SnowPluginIcons
import org.jetbrains.plugins.terminal.ShellTerminalWidget
import org.jetbrains.plugins.terminal.TerminalToolWindowManager

/**
 * Action to open Snow CLI in terminal
 */
class OpenSnowTerminalAction : AnAction(
    "Open Snow CLI",
    "Open Snow CLI in integrated terminal",
    SnowPluginIcons.SnowAction
) {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return

        // Use Terminal API to send command directly
        ApplicationManager.getApplication().invokeLater {
            try {
                val terminalManager = TerminalToolWindowManager.getInstance(project)

                // Create new terminal session with activateTool=true to show the terminal window
                val widget = terminalManager.createLocalShellWidget(project.basePath, "Snow CLI", true, true)

                if (widget is ShellTerminalWidget) {
                    // Wait a bit for terminal to be ready, then send command
                    ApplicationManager.getApplication().executeOnPooledThread {
                        try {
                            Thread.sleep(1000)

                            // Send command directly to terminal using executeCommand
                            ApplicationManager.getApplication().invokeLater {
                                try {
                                    widget.executeCommand("snow")
                                } catch (ex: Exception) {
                                    // Silently handle command execution failure
                                }
                            }
                        } catch (ex: Exception) {
                            // Silently handle background thread failure
                        }
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

