# BayanGo User App → Android Native (Kotlin) Plan

## Decision: Kotlin (not Java)
Kotlin is the recommended language for modern Android apps because it has:
- First-party support with Jetpack libraries.
- Safer null handling.
- Better developer productivity vs Java.
- Better fit for Compose (modern native UI toolkit).

## Scope (Improved Native)
This project will copy user-app core flows and adapt UX to Android-native patterns:

1. Authentication
2. Home + search
3. Product/merchant browsing
4. Cart and checkout
5. Order tracking
6. Profile and settings
7. Push notifications
8. Offline-aware caching for key screens

## Proposed stack
- Language: Kotlin
- UI: Jetpack Compose + Material 3
- Architecture: MVVM + Repository pattern
- Async: Kotlin Coroutines + Flow
- DI: Hilt
- Networking: Retrofit + OkHttp
- Local storage: Room + DataStore
- Maps/Location: Google Maps + Fused Location Provider
- Notifications: Firebase Cloud Messaging

## Initial package name
`com.bayango.usernative`

## Milestones
1. Scaffold app and navigation shell
2. Port auth and session flow
3. Port browse/cart/checkout flow
4. Port order tracking flow
5. Add push + offline support
6. QA pass and release build
