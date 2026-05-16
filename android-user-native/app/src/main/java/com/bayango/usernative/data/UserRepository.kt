package com.bayango.usernative.data

import kotlinx.coroutines.delay

interface UserRepository {
    suspend fun signIn(email: String, password: String): Result<UserSession>
    fun merchants(): List<Merchant>
    fun orders(): List<Order>
    fun profile(email: String): UserProfile
}

class DemoUserRepository : UserRepository {
    override suspend fun signIn(email: String, password: String): Result<UserSession> {
        delay(400)
        return if (!email.contains('@') || password.length < 6) {
            Result.failure(IllegalArgumentException("Invalid credentials. Use a valid email and 6+ character password."))
        } else {
            Result.success(UserSession(email.trim()))
        }
    }

    override fun merchants(): List<Merchant> = listOf(
        Merchant("m1", "Aling Nena Eatery", 18, listOf("Filipino", "Budget Meal")),
        Merchant("m2", "BayanGo Fresh Mart", 25, listOf("Groceries", "Essentials")),
        Merchant("m3", "Kape at Tinapay", 14, listOf("Coffee", "Bakery"))
    )

    override fun orders(): List<Order> = listOf(
        Order("#BAY-20260516-019", "Rider is on the way", "Expected in 12 mins"),
        Order("#BAY-20260516-013", "Preparing your items", "Merchant confirmed your order")
    )

    override fun profile(email: String): UserProfile = UserProfile(
        email.substringBefore('@').ifBlank { "BayanGo User" },
        "Poblacion, Makati",
        "Cash / eWallet"
    )
}
