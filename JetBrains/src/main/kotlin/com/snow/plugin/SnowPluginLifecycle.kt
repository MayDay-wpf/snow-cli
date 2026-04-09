package com.snow.plugin

import com.intellij.ide.AppLifecycleListener
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.project.ProjectManagerListener

/**
 * Plugin lifecycle listener
 */
class SnowPluginLifecycle : AppLifecycleListener {
    private val wsManager = SnowWebSocketManager.instance

    override fun appFrameCreated(commandLineArgs: MutableList<String>) {
        wsManager.connect()

        ApplicationManager.getApplication().messageBus.connect()
            .subscribe(ProjectManager.TOPIC, object : ProjectManagerListener {
                override fun projectClosed(project: Project) {
                    cleanupProject(project)
                }
            })

        for (project in ProjectManager.getInstance().openProjects) {
            setupProject(project)
        }
    }

    override fun appWillBeClosed(isRestart: Boolean) {
        wsManager.disconnect()
    }

    companion object {
        private val trackers = mutableMapOf<Project, SnowEditorContextTracker>()
        private val handlers = mutableMapOf<Project, SnowMessageHandler>()

        fun setupProject(project: Project) {
            if (!trackers.containsKey(project)) {
                val tracker = SnowEditorContextTracker(project)
                val handler = SnowMessageHandler(project)
                trackers[project] = tracker
                handlers[project] = handler

                ApplicationManager.getApplication().executeOnPooledThread {
                    tracker.sendEditorContext()

                    for (i in 1..3) {
                        Thread.sleep(1000)
                        tracker.sendEditorContext()
                    }
                }
            }
        }

        fun cleanupProject(project: Project) {
            trackers.remove(project)
            handlers.remove(project)
        }
    }
}
