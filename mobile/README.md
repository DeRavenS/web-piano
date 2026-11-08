# Web Piano — Android app

A thin Flutter shell around the web app in the repo root. The web files are bundled
into the APK (`assets/web`) and served from a localhost server inside the app, so
everything works offline and the browser engine allows the microphone.

## Build

```powershell
.\build-release.ps1   # syncs the web app, then: flutter build apk --release
```

The APK lands in `build\app\outputs\flutter-apk\app-release.apk`.

Never edit `assets/web` by hand: it is overwritten from the repo root by `sync-web.ps1`
and is not committed.

## Signing

Release APKs are signed with the permanent upload key
`C:\Users\stolt\keystores\web-piano-upload.jks` (alias `upload`). Its passwords live
only in the git-ignored `android/key.properties`:

```properties
storePassword=...
keyPassword=...
keyAlias=upload
storeFile=C:/Users/stolt/keystores/web-piano-upload.jks
```

A release build fails if `key.properties` is missing; it never falls back to the debug
key. **Back up the `.jks` and `key.properties`**: without them no future APK can
install over the current one.

App id: `com.deravens.webpiano`.
