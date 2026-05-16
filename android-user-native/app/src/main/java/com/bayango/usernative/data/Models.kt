package com.bayango.usernative.data

data class Merchant(val id: String, val name: String, val etaMinutes: Int, val tags: List<String>)
data class Order(val id: String, val status: String, val detail: String)
data class UserProfile(val name: String, val address: String, val payment: String)

data class UserSession(val email: String)

data class AppState(
    val session: UserSession? = null,
    val merchants: List<Merchant> = emptyList(),
    val orders: List<Order> = emptyList(),
    val profile: UserProfile? = null,
    val loading: Boolean = false,
    val error: String? = null
)
