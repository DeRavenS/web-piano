# Builds the signed release APK: build-release.ps1
# Output: build\app\outputs\flutter-apk\app-release.apk
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
& "$PSScriptRoot\sync-web.ps1"

# Avast intercepts HTTPS on this PC and rotates its root certificate, which
# breaks Gradle downloads (PKIX errors). Trust the current one via a private
# copy of the JDK truststore instead of editing Android Studio's JDK.
$avast = Get-ChildItem Cert:\LocalMachine\Root | Where-Object Subject -match 'Avast Web/Mail Shield Root' | Select-Object -First 1
if ($avast) {
  $jbr = 'E:\AndroidStudio\jbr'
  $store = "$env:USERPROFILE\cacerts_avast"
  $cer = "$env:USERPROFILE\avast_root.cer"
  [IO.File]::WriteAllBytes($cer, $avast.RawData)
  Copy-Item "$jbr\lib\security\cacerts" $store -Force
  # keytool reports success on stderr, so judge it by exit code only.
  $ErrorActionPreference = 'Continue'
  & "$jbr\bin\keytool.exe" -importcert -noprompt -alias avast-current -file $cer -keystore $store -storepass changeit 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "keytool failed to import the Avast root certificate" }
  $ErrorActionPreference = 'Stop'
  $env:JAVA_TOOL_OPTIONS = "-Djavax.net.ssl.trustStore=$store -Djavax.net.ssl.trustStorePassword=changeit"
}

$ErrorActionPreference = 'Continue'  # flutter/gradle log progress on stderr
flutter build apk --release
if ($LASTEXITCODE -ne 0) { throw "flutter build failed" }
