package com.bayango.usernative

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExitToApp
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material3.AssistChip
import androidx.compose.material3.BottomAppBar
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.bayango.usernative.data.Merchant
import com.bayango.usernative.data.Order
import com.bayango.usernative.data.UserProfile
import com.bayango.usernative.ui.UserViewModel

private data class TabItem(val label: String, val icon: ImageVector)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { BayanGoUserApp() }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BayanGoUserApp(vm: UserViewModel = viewModel()) {
    val state by vm.state.collectAsState()

    if (state.session == null) {
        LoginScreen(loading = state.loading, error = state.error, onSignIn = vm::signIn)
        return
    }

    val tabs = listOf(TabItem("Home", Icons.Default.Home), TabItem("Orders", Icons.Default.ReceiptLong), TabItem("Profile", Icons.Default.Person))
    var selectedTab by remember { mutableStateOf(0) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("BayanGo") },
                actions = {
                    Button(onClick = vm::signOut) {
                        Icon(Icons.Default.ExitToApp, contentDescription = "Sign out")
                        Text("Logout")
                    }
                }
            )
        },
        bottomBar = {
            BottomAppBar {
                tabs.forEachIndexed { index, tab ->
                    NavigationBarItem(selected = selectedTab == index, onClick = { selectedTab = index }, icon = { Icon(tab.icon, contentDescription = tab.label) }, label = { Text(tab.label) })
                }
            }
        }
    ) { padding ->
        when (selectedTab) {
            0 -> HomeScreen(padding, state.merchants)
            1 -> OrdersScreen(padding, state.orders)
            else -> ProfileScreen(padding, state.profile)
        }
    }
}

@Composable
private fun LoginScreen(loading: Boolean, error: String?, onSignIn: (String, String) -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Text("BayanGo Sign In", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        OutlinedTextField(value = email, onValueChange = { email = it }, modifier = Modifier.fillMaxWidth().padding(top = 14.dp), label = { Text("Email") }, singleLine = true)
        OutlinedTextField(value = password, onValueChange = { password = it }, modifier = Modifier.fillMaxWidth().padding(top = 10.dp), label = { Text("Password") }, singleLine = true, visualTransformation = PasswordVisualTransformation())
        if (error != null) Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
        Button(onClick = { onSignIn(email, password) }, enabled = !loading, modifier = Modifier.fillMaxWidth().padding(top = 14.dp)) {
            if (loading) CircularProgressIndicator(strokeWidth = 2.dp)
            else Text("Sign In")
        }
        Text("Demo mode: use any email + password with at least 6 characters.", modifier = Modifier.padding(top = 8.dp), style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun HomeScreen(padding: PaddingValues, merchants: List<Merchant>) { var query by remember { mutableStateOf("") }
    val filtered = merchants.filter { query.isBlank() || it.name.contains(query, ignoreCase = true) || it.tags.any { tag -> tag.contains(query, ignoreCase = true) } }
    LazyColumn(modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text("Good day!", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold); Text("Order from nearby stores with a native Android flow.") }
        item { OutlinedTextField(value = query, onValueChange = { query = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Search merchants or category") }, singleLine = true) }
        items(filtered) { merchant ->
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(merchant.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text("ETA: ${merchant.etaMinutes} mins")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { merchant.tags.forEach { tag -> AssistChip(onClick = { }, label = { Text(tag) }) } }
                }
            }
        }
    }
}

@Composable
private fun OrdersScreen(padding: PaddingValues, orders: List<Order>) {
    Column(modifier = Modifier.fillMaxSize().padding(padding).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Orders", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        orders.forEach { StatusCard(it.id, it.status, it.detail) }
    }
}

@Composable
private fun StatusCard(id: String, status: String, detail: String) {
    Card { Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { Text(id, style = MaterialTheme.typography.labelLarge); Text(status, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold); Text(detail) } }
}

@Composable
private fun ProfileScreen(padding: PaddingValues, profile: UserProfile?) {
    Column(modifier = Modifier.fillMaxSize().padding(padding).padding(20.dp), horizontalAlignment = Alignment.Start, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Profile", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Text("Name: ${profile?.name ?: "-"}")
        Text("Address: ${profile?.address ?: "-"}")
        Text("Payment: ${profile?.payment ?: "-"}")
    }
}
