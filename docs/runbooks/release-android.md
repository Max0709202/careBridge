# Releasing on Android

The same three destinations as iOS — **a phone on your desk**, **a closed test
track**, **Google Play** — with one large difference: all of it builds on
Linux. There is no Mac in this document.

| App | Application id | Who installs it |
| --- | --- | --- |
| CareBridge | `com.carebridge.family` | the family |
| CareBridge Driver | `com.carebridge.driver` | drivers, usually issued by their operator |

An application id is **immutable once Play has accepted an upload under it**.
It cannot be renamed, only abandoned for a new listing that starts at zero
installs and zero reviews. Both were `com.example.…` until recently, which Play
rejects outright — that was a good rejection.

---

## 0. Before the first build, once

**A Google Play Developer account — $25, one time.** Individual accounts
created after 2023 must also complete identity verification, and a new personal
developer account has to run a **closed test with 12 testers for 14 continuous
days** before it may apply for production access. That is a calendar
requirement, not a paperwork one: it cannot be shortened, and it is the reason
to create the account and start the closed test *now* rather than when the app
is ready. Organisation accounts are exempt from the 12-tester rule but need a
D-U-N-S number.

**Create the upload keystore**, once, and keep it somewhere that outlives this
laptop:

```bash
keytool -genkey -v -keystore ~/carebridge-upload.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

Then copy `key.properties.example` to `key.properties` beside it, in
`android/` for the family app and `apps/driver_app/android/` for the driver
app, and fill in the four values. Both files are in `.gitignore` along with
`*.jks`, and they need to stay there: an upload key in the repository lets
anyone with read access publish as CareBridge.

**Play App Signing holds the real key.** What you generated is the *upload*
key — Play re-signs with a key it manages and never gives you. The practical
consequence is good: a lost upload key is a support ticket rather than the end
of the listing. A lost *app* signing key, on a legacy listing that opted out,
is the end of the listing. Do not opt out.

Without `key.properties` the release build falls back to the debug key so that
`flutter run --release` still works. That build is **not** uploadable, and Play
rejects it at upload with a clear message. The fallback and the reasoning are
in `android/app/build.gradle.kts`.

---

## 1. Onto a phone on your desk

Enable **Developer options** (tap Build number seven times) and **USB
debugging**, then:

```bash
flutter devices
flutter run --release -d <device-id> \
  --dart-define=CAREBRIDGE_API_BASE_URL=https://staging.carebridge.example/api/v1
```

**The `--dart-define` is required on a device** for the same reason as on iOS:
the default `/api/v1` is relative, which only means something when nginx is
serving the app from the same origin. The build now fails at startup rather
than rendering every screen as a network error.

On the same LAN against a laptop API, `10.0.2.2` is the *emulator's* alias for
the host — a physical handset needs the machine's LAN address, and `localhost`
on a phone is the phone. `make driver` already uses `10.0.2.2`.

Cleartext `http://` is blocked by default from Android 9 onward, the same as
iOS. Use HTTPS or a tunnel rather than adding a cleartext exemption.

---

## 2. A test track

Play has four: **internal** (up to 100 testers, available in minutes, no
review), **closed**, **open**, and **production**. Internal testing is the
right one for a pilot, and closed testing is the one a new personal developer
account must complete for 14 days regardless.

```bash
flutter build appbundle --release \
  --dart-define=CAREBRIDGE_API_BASE_URL=https://staging.carebridge.example/api/v1
```

That writes `build/app/outputs/bundle/release/app-release.aab`. Upload it in
the Play Console under the chosen track.

**An `.aab`, not an `.apk`.** Play has required the App Bundle for new apps
since August 2021. Play builds the per-device APKs from it, which is why the
54 MB bundle becomes a much smaller download — an APK would ship every screen
density and every ABI to every phone. `flutter build apk` remains useful for
handing a build to someone directly, over a cable or a link, with no Play
account involved.

---

## 3. Production

Everything the listing needs — the store description, the graphics, the
**Data safety** answers, the content rating questionnaire, and the test
credentials for review — is in
[`../product/store-listing.md`](../product/store-listing.md).

### What will get these two apps rejected

**Background location (the big one).** Play's location policy is stricter than
Apple's and is enforced by a human watching a video. `ACCESS_BACKGROUND_LOCATION`
is deliberately **absent** from the driver app's manifest: the app uses a
foreground service with `FOREGROUND_SERVICE_LOCATION`, which runs only while a
ride is under way and posts a notification that says so for the whole time it
runs. That is a materially smaller permission than the always-on one and it is
the honest description of what the app does.

If `ACCESS_BACKGROUND_LOCATION` is ever added, the listing needs a **video
demonstration** of the in-app feature that uses it and a prominent-disclosure
screen shown *before* the permission prompt, and review takes weeks. The
current design avoids all of that. Keep it.

**Foreground service type declaration.** Play requires a declaration of why
each foreground service type is used. The answer for `location` is: the app
reports the driver's position to the family tracking the ride they are on, and
only during that ride.

**Data safety must match what the app does.** Play cross-checks the
declaration against observed behaviour, and a mismatch gets the listing
suspended rather than merely rejected. The answers in `store-listing.md` are
derived from `docs/privacy/data-map.md`, which is the document that actually
knows.

**Account deletion.** Play requires both an in-app path *and* a publicly
reachable web URL where deletion can be requested without installing the app.
The URL goes in the Data safety form. Check the current settings screen before
submitting.

**Target API level.** Play requires new apps to target a recent API level and
raises the floor every August; missing it blocks *updates* to an existing
listing, which is worse than blocking the first one. The build targets the
Flutter SDK's current default (36) and compiles against 37.

**Health claims.** As on iOS — coordination and transport, not diagnosis or
treatment. Medical claims change the content rating and invite a different
review.

---

## Versioning

`version: 0.1.0+1` in `pubspec.yaml` gives `versionName` `0.1.0` and
`versionCode` `1`. Play refuses a bundle whose `versionCode` it has already
accepted **on any track**, so an internal-test upload consumes the number too.
Increment the digits after the `+`.

---

## Checklist

- [ ] Play Developer account verified; closed-test clock started if it applies
- [ ] `key.properties` and the `.jks` exist, are filled in, and are **not** committed
- [ ] The keystore is backed up somewhere that is not this machine
- [ ] Built as `.aab` with `--dart-define=CAREBRIDGE_API_BASE_URL=https://…`
- [ ] Pointed at a **production** API for a production track
- [ ] `versionCode` higher than anything previously uploaded, on any track
- [ ] Data safety answers match `docs/privacy/data-map.md`
- [ ] Foreground service type justified in the form
- [ ] Account deletion reachable in-app **and** at a public URL
- [ ] Test credentials given, and the driver account has a job on it
