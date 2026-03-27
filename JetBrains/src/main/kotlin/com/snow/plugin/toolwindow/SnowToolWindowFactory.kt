package com.snow.plugin.toolwindow

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.openapi.wm.ex.ToolWindowManagerListener
import com.intellij.ui.components.JBLabel
import com.intellij.ui.content.ContentFactory
import com.snow.plugin.SnowWebSocketManager
import com.snow.plugin.util.TerminalCompat
import java.awt.BorderLayout
import javax.swing.JPanel

class SnowToolWindowFactory : ToolWindowFactory, DumbAware {
    companion object {
        private val isLaunching = mutableMapOf<String, Boolean>()
    }
    
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val contentPanel = JPanel(BorderLayout())
        val label = JBLabel("Snow CLI will launch when you open this window", javax.swing.SwingConstants.CENTER)
        contentPanel.add(label, BorderLayout.CENTER)
        
        val contentFactory = ContentFactory.getInstance()
        val content = contentFactory.createContent(contentPanel, "", false)
        toolWindow.contentManager.addContent(content)
        
        val projectKey = project.basePath ?: project.name
        val connection = project.messageBus.connect()
        
        connection.subscribe(ToolWindowManagerListener.TOPIC, object : ToolWindowManagerListener {
            override fun stateChanged(toolWindowManager: com.intellij.openapi.wm.ToolWindowManager) {
                if (toolWindow.isVisible) {
                    synchronized(isLaunching) {
                        if (isLaunching[projectKey] != true) {
                            isLaunching[projectKey] = true
                            launchSnowCLI(project, toolWindow, projectKey)
                        }
                    }
                }
            }
        })
    }
    
    private fun launchSnowCLI(project: Project, toolWindow: ToolWindow, projectKey: String) {
        ApplicationManager.getApplication().invokeLater {
            try {
                TerminalCompat.openTerminalWithCommand(project, project.basePath, "Snow CLI", "snow")

                ApplicationManager.getApplication().invokeLater {
                    toolWindow.hide(null)
                    synchronized(isLaunching) {
                        isLaunching[projectKey] = false
                    }
                }
            } catch (_: Exception) {
                synchronized(isLaunching) {
                    isLaunching[projectKey] = false
                }
            }
        }
        
        val wsManager = SnowWebSocketManager.instance
        ApplicationManager.getApplication().executeOnPooledThread {
            Thread.sleep(500)
            wsManager.connect()
        }
    }
}
