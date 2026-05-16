package com.bayango.usernative.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.bayango.usernative.data.AppState
import com.bayango.usernative.BuildConfig
import com.bayango.usernative.data.DemoUserRepository
import com.bayango.usernative.data.FirebaseUserRepository
import com.bayango.usernative.data.UserRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class UserViewModel(
    private val repo: UserRepository = if (BuildConfig.USE_FIREBASE_REPOSITORY) FirebaseUserRepository() else DemoUserRepository()
) : ViewModel() {

    private val _state = MutableStateFlow(AppState())
    val state: StateFlow<AppState> = _state.asStateFlow()

    fun signIn(email: String, password: String) {
        runAuth { repo.signIn(email, password) }
    }

    fun signUp(email: String, password: String) {
        runAuth { repo.signUp(email, password) }
    }

    private fun runAuth(block: suspend () -> Result<com.bayango.usernative.data.UserSession>) {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            val result = block()
            result.onSuccess { session ->
                _state.update {
                    it.copy(
                        session = session,
                        merchants = repo.merchants(),
                        orders = repo.orders(),
                        profile = repo.profile(session.email),
                        loading = false
                    )
                }
            }.onFailure { ex ->
                _state.update { it.copy(loading = false, error = ex.message ?: "Sign in failed") }
            }
        }
    }

    fun signOut() {
        _state.value = AppState()
    }
}
