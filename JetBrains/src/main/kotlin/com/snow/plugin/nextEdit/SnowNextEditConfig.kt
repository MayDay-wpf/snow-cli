package com.snow.plugin.nextEdit

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

@State(name = "SnowNextEditConfig", storages = [Storage("snow-next-edit.xml")])
@Service(Service.Level.APP)
class SnowNextEditConfig : PersistentStateComponent<SnowNextEditConfig.State> {

    data class State(
        var enabled: Boolean = false,
        var scope: String = "file",
        var usePsiReferences: Boolean = true,
        var maxCandidates: Int = 20,
        var minPatternLength: Int = 2,
        var debounceMs: Int = 350,
    )

    private var myState = State()

    override fun getState(): State = myState
    override fun loadState(state: State) {
        myState = state
    }

    val enabled get() = myState.enabled
    val scope get() = myState.scope
    val usePsiReferences get() = myState.usePsiReferences
    val maxCandidates get() = myState.maxCandidates
    val minPatternLength get() = myState.minPatternLength
    val debounceMs get() = myState.debounceMs

    companion object {
        fun getInstance(): SnowNextEditConfig =
            ApplicationManager.getApplication().getService(SnowNextEditConfig::class.java)
    }
}
