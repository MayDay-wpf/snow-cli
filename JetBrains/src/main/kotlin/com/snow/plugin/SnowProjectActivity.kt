package com.snow.plugin

import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity

class SnowProjectActivity : ProjectActivity {
    override suspend fun execute(project: Project) {
        SnowPluginLifecycle.setupProject(project)
        ApplicationManager.getApplication().invokeLater {
            registerProjectViewAction()
        }
    }

    companion object {
        @Volatile
        private var registered = false

        private fun registerProjectViewAction() {
            if (registered) return
            val actionManager = ActionManager.getInstance()
            val sendAction = actionManager.getAction("snow.SendToSnowCLI") ?: return
            val group = actionManager.getAction("ProjectViewPopupMenu") as? DefaultActionGroup ?: return
            group.addSeparator()
            group.add(sendAction)
            registered = true
        }
    }
}
