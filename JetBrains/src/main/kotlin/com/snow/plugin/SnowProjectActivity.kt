package com.snow.plugin

import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity

class SnowProjectActivity : ProjectActivity {
    override suspend fun execute(project: Project) {
        SnowPluginLifecycle.setupProject(project)
    }
}
