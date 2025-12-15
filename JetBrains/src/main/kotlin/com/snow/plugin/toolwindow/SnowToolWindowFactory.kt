package com.snow.plugin.toolwindow

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
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
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        // Create a simple content panel
        val contentPanel = JPanel(BorderLayout())
        val label = JBLabel("Click to launch Snow CLI", javax.swing.SwingConstants.CENTER)
        contentPanel.add(label, BorderLayout.CENTER)
        
        val contentFactory = ContentFactory.getInstance()
        val content = contentFactory.createContent(contentPanel, "", false)
        toolWindow.contentManager.addContent(content)
        
        // Add listener to launch Snow CLI when tool window is shown/activated
        val listener = object : com.intellij.openapi.wm.ex.ToolWindowManagerListener {
            override fun stateChanged(toolWindowManager: com.intellij.openapi.wm.ToolWindowManager) {
                if (toolWindow.isVisible) {
                    // Launch Snow CLI each time window becomes visible
                    launchSnowCLI(project, toolWindow)
                }
            }
        }
        
        project.messageBus.connect().subscribe(
            com.intellij.openapi.wm.ex.ToolWindowManagerListener.TOPIC,
            listener
        )
    }
    
    private fun launchSnowCLI(project: Project, toolWindow: ToolWindow) {
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
}



