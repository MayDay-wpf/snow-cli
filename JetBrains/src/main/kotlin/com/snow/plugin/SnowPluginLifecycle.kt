package com.snow.plugin

import com.intellij.ide.AppLifecycleListener
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorManagerListener
import com.intellij.openapi.fileEditor.FileEditorManagerEvent
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.project.ProjectManagerListener
import com.snow.plugin.completion.SnowCompletionService
import com.snow.plugin.nextEdit.SnowNextEditEngine

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

        // Eagerly initialize completion service so EditorFactoryListener is registered
        try {
            SnowCompletionService.getInstance()
        } catch (e: Exception) {
            logger.warn("Failed to initialize completion service", e)
        }

        for (project in ProjectManager.getInstance().openProjects) {
            setupProject(project)
        }
    }

    override fun appWillBeClosed(isRestart: Boolean) {
        wsManager.disconnect()
    }

    companion object {
        private val logger = Logger.getInstance(SnowPluginLifecycle::class.java)
        private val trackers = mutableMapOf<Project, SnowEditorContextTracker>()
        private val handlers = mutableMapOf<Project, SnowMessageHandler>()

        fun setupProject(project: Project) {
            SnowWebSocketManager.instance.updatePortInfoForProject(project)

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

            initNextEditForProject(project)
        }

        fun cleanupProject(project: Project) {
            SnowWebSocketManager.instance.cleanupPortInfoForProject(project)
            trackers.remove(project)
            handlers.remove(project)
        }

        private fun initNextEditForProject(project: Project) {
            try {
                val engine = SnowNextEditEngine.getInstance(project)
                val editorManager = FileEditorManager.getInstance(project)

                // Register all currently open editors
                for (file in editorManager.openFiles) {
                    val editors = editorManager.getEditors(file)
                    for (fileEditor in editors) {
                        val textEditor = fileEditor as? com.intellij.openapi.fileEditor.TextEditor ?: continue
                        engine.registerDocument(textEditor.editor)
                    }
                }

                // Register future editors on selection change
                project.messageBus.connect().subscribe(
                    FileEditorManagerListener.FILE_EDITOR_MANAGER,
                    object : FileEditorManagerListener {
                        override fun selectionChanged(event: FileEditorManagerEvent) {
                            val editor = FileEditorManager.getInstance(project).selectedTextEditor
                            if (editor != null) engine.registerDocument(editor)
                        }
                    },
                )
            } catch (e: Exception) {
                logger.warn("Failed to init Next Edit for project", e)
            }
        }

    }
}
