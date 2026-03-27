package com.snow.plugin.util

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project

/**
 * Compatibility layer for terminal API across IntelliJ versions.
 * Uses Reworked Terminal API (2025.3+) when available, falls back to classic API via reflection.
 */
object TerminalCompat {

    fun openTerminalWithCommand(project: Project, workingDirectory: String?, tabName: String, command: String) {
        if (!tryReworkedApi(project, workingDirectory, tabName, command)) {
            fallbackClassicApi(project, workingDirectory, tabName, command)
        }
    }

    private fun tryReworkedApi(
        project: Project, workingDirectory: String?, tabName: String, command: String
    ): Boolean {
        return try {
            val mgrClass = Class.forName(
                "com.intellij.terminal.frontend.toolwindow.TerminalToolWindowTabsManager"
            )
            val mgr = mgrClass.getMethod("getInstance", Project::class.java).invoke(null, project)

            val bClass = Class.forName(
                "com.intellij.terminal.frontend.toolwindow.TerminalToolWindowTabBuilder"
            )
            var b: Any = mgrClass.getMethod("createTabBuilder").invoke(mgr)!!
            b = bClass.getMethod("workingDirectory", String::class.java).invoke(b, workingDirectory)!!
            b = bClass.getMethod("tabName", String::class.java).invoke(b, tabName)!!
            b = bClass.getMethod("requestFocus", java.lang.Boolean.TYPE).invoke(b, true)!!
            b = bClass.getMethod("deferSessionStartUntilUiShown", java.lang.Boolean.TYPE).invoke(b, true)!!
            val tab = bClass.getMethod("createTab").invoke(b)!!

            val tClass = Class.forName("com.intellij.terminal.frontend.toolwindow.TerminalToolWindowTab")
            val view = tClass.getMethod("getView").invoke(tab)!!
            val vClass = Class.forName("com.intellij.terminal.frontend.view.TerminalView")

            scheduleCommand {
                vClass.getMethod("sendText", String::class.java).invoke(view, "$command\n")
            }
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun fallbackClassicApi(
        project: Project, workingDirectory: String?, tabName: String, command: String
    ) {
        try {
            val mgrClass = Class.forName("org.jetbrains.plugins.terminal.TerminalToolWindowManager")
            val mgr = mgrClass.getMethod("getInstance", Project::class.java).invoke(null, project)
            val widget = mgrClass.getMethod(
                "createShellWidget",
                String::class.java, String::class.java,
                java.lang.Boolean.TYPE, java.lang.Boolean.TYPE
            ).invoke(mgr, workingDirectory, tabName, true, true)!!

            scheduleCommand {
                widget.javaClass.getMethod("sendCommandToExecute", String::class.java)
                    .invoke(widget, command)
            }
        } catch (_: Exception) {
        }
    }

    private fun scheduleCommand(action: () -> Unit) {
        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                Thread.sleep(1000)
                ApplicationManager.getApplication().invokeLater {
                    try {
                        action()
                    } catch (_: Exception) {
                    }
                }
            } catch (_: Exception) {
            }
        }
    }
}
