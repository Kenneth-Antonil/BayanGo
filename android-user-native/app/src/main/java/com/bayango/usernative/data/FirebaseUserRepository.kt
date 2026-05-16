package com.bayango.usernative.data

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.tasks.await

class FirebaseUserRepository(
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
    private val db: FirebaseFirestore = FirebaseFirestore.getInstance()
) : UserRepository {

    override suspend fun signIn(email: String, password: String): Result<UserSession> = runCatching {
        require(email.contains('@')) { "Invalid email." }
        require(password.length >= 6) { "Password must be at least 6 characters." }
        val result = auth.signInWithEmailAndPassword(email.trim(), password).await()
        UserSession(result.user?.email ?: email.trim())
    }

    override fun merchants(): List<Merchant> = emptyList()
    override fun orders(): List<Order> = emptyList()
    override fun profile(email: String): UserProfile = UserProfile(email.substringBefore('@'), "", "")

    suspend fun fetchMerchants(collectionPath: String = "merchants"): List<Merchant> {
        val snapshot = db.collection(collectionPath).get().await()
        return snapshot.documents.mapNotNull { doc ->
            val name = doc.getString("name") ?: return@mapNotNull null
            val eta = (doc.getLong("etaMinutes") ?: 0L).toInt()
            val tags = (doc.get("tags") as? List<*>)?.filterIsInstance<String>() ?: emptyList()
            Merchant(doc.id, name, eta, tags)
        }
    }

    suspend fun fetchOrders(userEmail: String, collectionPath: String = "orders"): List<Order> {
        val snapshot = db.collection(collectionPath)
            .whereEqualTo("userEmail", userEmail)
            .get()
            .await()
        return snapshot.documents.mapNotNull { doc ->
            val status = doc.getString("status") ?: return@mapNotNull null
            val detail = doc.getString("detail") ?: ""
            Order(doc.id, status, detail)
        }
    }

    suspend fun fetchProfile(userEmail: String, collectionPath: String = "users"): UserProfile {
        val snapshot = db.collection(collectionPath)
            .whereEqualTo("email", userEmail)
            .limit(1)
            .get()
            .await()
        val doc = snapshot.documents.firstOrNull()
        return UserProfile(
            name = doc?.getString("name") ?: userEmail.substringBefore('@'),
            address = doc?.getString("address") ?: "",
            payment = doc?.getString("payment") ?: ""
        )
    }
}
