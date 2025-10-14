package com.snow.plugin

import com.intellij.ide.AppLifecycleListener
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.project.ProjectManagerListener

/**
 * Plugin lifecycle listener
 */
class SnowPluginLifecycle : AppLifecycleListener {
    private val wsManager = SnowWebSocketManager.instance
    private val trackers = mutableMapOf<Project, SnowEditorContextTracker>()
    private val handlers = mutableMapOf<Project, SnowMessageHandler>()

    override fun appFrameCreated(commandLineArgs: MutableList<String>) {
        // Connect to Snow CLI on startup
        wsManager.connect()

        // Setup project listeners
        ApplicationManager.getApplication().messageBus.connect()
            .subscribe(ProjectManager.TOPIC, object : ProjectManagerListener {
                override fun projectOpened(project: Project) {
                    setupProject(project)
                }

                override fun projectClosed(project: Project) {
                    cleanupProject(project)
                }
            })

        // Setup existing projects
        for (project in ProjectManager.getInstance().openProjects) {
            setupProject(project)
        }
    }

    override fun appWillBeClosed(isRestart: Boolean) {
        wsManager.disconnect()
    }

    /**
     * Setup tracking for a project
     */
    private fun setupProject(project: Project) {
        if (!trackers.containsKey(project)) {
            val tracker = SnowEditorContextTracker(project)
            val handler = SnowMessageHandler(project)
            trackers[project] = tracker
            handlers[project] = handler

            // Send initial context after a small delay to ensure WebSocket is ready
            ApplicationManager.getApplication().executeOnPooledThread {
                Thread.sleep(500) // Wait for WebSocket connection
                tracker.sendEditorContext()
            }
        }
    }

    /**
     * Cleanup tracking for a project
     */
    private fun cleanupProject(project: Project) {
        trackers.remove(project)
        handlers.remove(project)
    }
}
