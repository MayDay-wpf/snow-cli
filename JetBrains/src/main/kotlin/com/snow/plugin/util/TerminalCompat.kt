package com.snow.plugin.util

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager

/**
 * Compatibility layer for terminal API across IntelliJ versions.
 * Uses Reworked Terminal API (2025.3+) when available, falls back to classic API via reflection.
 */
object TerminalCompat {

    @Volatile
    private var lastTerminalRef: Any? = null

    fun openTerminalWithCommand(project: Project, workingDirectory: String?, tabName: String, command: String) {
        if (!tryReworkedApi(project, workingDirectory, tabName, command)) {
            fallbackClassicApi(project, workingDirectory, tabName, command)
        }
    }

    /**
     * Send text to an existing Snow CLI terminal (without pressing Enter).
     * Uses saved terminal reference first, falls back to component tree search.
     */
    fun sendTextToNamedTerminal(project: Project, tabName: String, text: String): Boolean {
        // Strategy 1: use the saved reference from openTerminalWithCommand
        lastTerminalRef?.let { ref ->
            if (trySendTextViaRef(ref, text)) {
                activateTerminalTab(project, tabName)
                return true
            }
        }

        // Strategy 2: search component tree in the matching terminal tab
        val toolWindow = ToolWindowManager.getInstance(project).getToolWindow("Terminal")
            ?: return false
        val content = toolWindow.contentManager.contents.firstOrNull {
            it.displayName == tabName || it.displayName.contains("Snow", ignoreCase = true)
        } ?: return false

        toolWindow.contentManager.setSelectedContent(content)
        toolWindow.activate(null, false, false)
        return sendTextToComponentTree(content.component, text)
    }

    private fun trySendTextViaRef(ref: Any, text: String): Boolean {
        // Reworked API: TerminalView.sendText(String)
        try {
            ref.javaClass.getMethod("sendText", String::class.java).invoke(ref, text)
            return true
        } catch (_: Exception) {}

        // Classic API: widget.getTtyConnector().write(String)
        try {
            val connector = ref.javaClass.getMethod("getTtyConnector").invoke(ref)
            if (connector != null) {
                connector.javaClass.getMethod("write", String::class.java).invoke(connector, text)
                return true
            }
        } catch (_: Exception) {}

        return false
    }

    private fun activateTerminalTab(project: Project, tabName: String) {
        val toolWindow = ToolWindowManager.getInstance(project).getToolWindow("Terminal") ?: return
        val content = toolWindow.contentManager.contents.firstOrNull {
            it.displayName == tabName || it.displayName.contains("Snow", ignoreCase = true)
        }
        if (content != null) {
            toolWindow.contentManager.setSelectedContent(content)
        }
        toolWindow.activate(null, false, false)
    }

    private fun sendTextToComponentTree(root: java.awt.Component, text: String): Boolean {
        if (trySendTextViaComponent(root, text)) return true
        if (root is java.awt.Container) {
            for (i in 0 until root.componentCount) {
                if (sendTextToComponentTree(root.getComponent(i), text)) return true
            }
        }
        return false
    }

    private fun trySendTextViaComponent(component: Any, text: String): Boolean {
        val className = component.javaClass.name
        if (className.startsWith("javax.swing.") || className.startsWith("java.awt.")) return false

        try {
            val connector = component.javaClass.getMethod("getTtyConnector").invoke(component)
            if (connector != null) {
                connector.javaClass.getMethod("write", String::class.java).invoke(connector, text)
                return true
            }
        } catch (_: Exception) {}

        try {
            component.javaClass.getMethod("sendText", String::class.java).invoke(component, text)
            return true
        } catch (_: Exception) {}

        return false
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

            lastTerminalRef = view

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

            lastTerminalRef = widget

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
