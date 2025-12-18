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
import org.jetbrains.plugins.terminal.ShellTerminalWidget
import org.jetbrains.plugins.terminal.TerminalToolWindowManager
import java.awt.BorderLayout
import javax.swing.JPanel

/**
 * Factory for Snow CLI Tool Window
 * Launches Snow CLI each time tool window is activated
 */
class SnowToolWindowFactory : ToolWindowFactory, DumbAware {
    companion object {
        private val isLaunching = mutableMapOf<String, Boolean>()
    }
    
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        // Create a simple content panel
        val contentPanel = JPanel(BorderLayout())
        val label = JBLabel("Snow CLI will launch when you open this window", javax.swing.SwingConstants.CENTER)
        contentPanel.add(label, BorderLayout.CENTER)
        
        val contentFactory = ContentFactory.getInstance()
        val content = contentFactory.createContent(contentPanel, "", false)
        toolWindow.contentManager.addContent(content)
        
        // Add listener for tool window visibility
        val projectKey = project.basePath ?: project.name
        val connection = project.messageBus.connect()
        
        connection.subscribe(ToolWindowManagerListener.TOPIC, object : ToolWindowManagerListener {
            override fun stateChanged(toolWindowManager: com.intellij.openapi.wm.ToolWindowManager) {
                if (toolWindow.isVisible) {
                    // Avoid duplicate launches
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
                
                // Hide Snow tool window and show terminal instead
                ApplicationManager.getApplication().invokeLater {
                    toolWindow.hide(null)
                    // Reset launching flag after hiding, so it can be launched again
                    synchronized(isLaunching) {
                        isLaunching[projectKey] = false
                    }
                }
            } catch (ex: Exception) {
                // Silently handle terminal access failure
                synchronized(isLaunching) {
                    isLaunching[projectKey] = false
                }
            }
        }
        
        // Ensure WebSocket server is running
        val wsManager = SnowWebSocketManager.instance
        ApplicationManager.getApplication().executeOnPooledThread {
            Thread.sleep(500)
            wsManager.connect()
        }
    }
}



