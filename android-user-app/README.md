# BayanGo User Android App

Android WebView wrapper ito para sa existing BayanGo User PWA.

## Ano ang ginagawa nito

- Binubuksan ang BayanGo User PWA sa native Android app shell.
- Same Firebase project at same PWA flow ang ginagamit dahil ang loaded URL ay existing deployed user app.
- May support sa JavaScript, local storage, Firebase web SDK, file upload, camera/gallery picker, location prompt, at back button.
- May simple offline screen kapag walang internet.

## Source PWA

`../hosting/user-demo/app.html`

Ang current loaded URL sa Android app:

```txt
https://bayango-315c6.web.app/user-demo/app.html
```

Kapag iba ang live URL mo, palitan ito sa:

```txt
app/src/main/java/com/bayango/user/MainActivity.kt
```

Hanapin:

```kotlin
private val userAppUrl = "https://bayango-315c6.web.app/user-demo/app.html"
```

## Paano buksan sa Android Studio

1. Open Android Studio.
2. Piliin ang **Open**.
3. Piliin ang folder na `android-user-app`.
4. Hintayin mag Gradle sync.
5. Run sa emulator o physical Android phone.

## Build APK

Sa Android Studio:

```txt
Build > Build Bundle(s) / APK(s) > Build APK(s)
```

O sa terminal:

```bash
cd android-user-app
./gradlew assembleDebug
```

Output:

```txt
app/build/outputs/apk/debug/app-debug.apk
```

## Important notes

- WebView wrapper ito, kaya hindi kailangan ulitin ang buong React/Firebase logic sa Android native code.
- Connected pa rin ito sa existing Firebase ng BayanGo User PWA dahil ang PWA mismo ang naka-Firebase.
- Para sa Play Store release, palitan ang package name kung kailangan, lagyan ng proper app icon, at gumawa ng signed release APK/AAB.
