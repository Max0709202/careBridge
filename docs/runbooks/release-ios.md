# Releasing on iOS

Three destinations, in the order anyone actually reaches them: **your own
iPhone**, **TestFlight**, **the App Store**. Each one adds a gate, and it is
worth knowing which gate you are standing at, because the fix for "it will not
install" is completely different at each.

Two apps ship here and they are separate listings, separate bundle
identifiers, separate review queues:

| App | Bundle id | Who installs it |
| --- | --- | --- |
| CareBridge | `com.carebridge.family` | the family |
| CareBridge Driver | `com.carebridge.driver` | drivers, usually issued by their operator |

The ops console is **not** on this page. It is a web app on its own origin and
it stays one — see the README on why the console and the family app are not one
bundle.

---

## What you cannot do from Linux

Everything below needs **macOS with Xcode**. This is not a preference of
Apple's that can be worked around: the iOS toolchain, the simulator, the code
signer and the uploader are macOS-only binaries. A Linux or Windows machine
cannot produce an `.ipa`, and no CI service builds one on anything but a Mac.

If there is no Mac, the options are a hosted Mac runner (GitHub Actions'
`macos-14`, Codemagic, Bitrise) or a rented Mac mini. Nothing else. Android
has no such restriction — see [`release-android.md`](release-android.md).

---

## 0. Before the first build, once

**An Apple Developer Program membership — $99/year.** A free Apple ID can
install on your own device for 7 days at a time; it cannot use TestFlight and
cannot reach the App Store. For a company listing, enrol as an *organisation*,
which needs a D-U-N-S number and takes days to weeks. Enrol early; it is the
long pole and it is pure waiting.

**Register the two bundle identifiers** in the Developer portal, then create
the two app records in App Store Connect.

**The driver app needs one capability declared**: Background Modes →
*Location updates*. The `UIBackgroundModes` key is already in
`apps/driver_app/ios/Runner/Info.plist`; the capability has to match it in
Xcode or the entitlement is missing at signing time.

---

## 1. Onto your own iPhone

```bash
cd apps/driver_app          # or the repo root for the family app
open ios/Runner.xcworkspace
```

In Xcode: select the **Runner** target → **Signing & Capabilities** → tick
*Automatically manage signing* → choose your Team. Xcode creates the profile.

Then, from the terminal, with the phone plugged in and unlocked:

```bash
flutter devices             # confirm the phone is listed
flutter run --release -d <device-id> \
  --dart-define=CAREBRIDGE_API_BASE_URL=https://staging.carebridge.example/api/v1
```

**That `--dart-define` is not optional on a device.** The default base URL is
the relative `/api/v1`, which is correct on web — nginx proxies `/api` from the
same origin — and meaningless on a phone, where there is no page to be relative
to. A build that omits it now fails loudly at startup rather than presenting
every screen as a network error; the check and the reason are in
`packages/dart/carebridge_client/lib/src/api_transport.dart` and pinned by
`test/base_url_test.dart`.

The first launch will refuse to open with *Untrusted Developer*. On the phone:
**Settings → General → VPN & Device Management → Developer App → Trust**. This
is once per device per signing identity, not once per build.

**`http://` will not load on a device.** iOS App Transport Security blocks
cleartext, so a laptop-hosted API needs either HTTPS or a tunnel
(`ngrok http 3000`). Do not add an ATS exemption to get around it — an
exemption shipped by accident is a downgrade attack on a product carrying home
addresses, and App Review asks about them.

---

## 2. TestFlight — the only sane way to test with real people

TestFlight distributes a real, store-signed build to real devices. Up to 100
**internal** testers (people on your App Store Connect team) get builds within
minutes and with no review. Up to 10,000 **external** testers get them after a
review that is lighter than a full App Store review — usually a day — and that
review is per *first* build, not per subsequent one.

For a pilot, internal testing is almost certainly what you want: the drivers
and the two or three families in the trial are a small enough list.

```bash
# From the app directory, on macOS:
flutter build ipa --release \
  --dart-define=CAREBRIDGE_API_BASE_URL=https://staging.carebridge.example/api/v1
```

That writes `build/ios/ipa/*.ipa`. Upload it with **Transporter** (free, Mac
App Store) or:

```bash
xcrun altool --upload-app --type ios \
  -f build/ios/ipa/carebridge_driver.ipa \
  --apiKey <key-id> --apiIssuer <issuer-id>
```

Then in App Store Connect → TestFlight: the build appears as *Processing* for
10–30 minutes, you answer the **export compliance** question (see below), and
you add testers.

Builds expire after **90 days**. A pilot longer than that needs a new build,
which is worth knowing before you promise a three-month trial.

---

## 3. The App Store

This is the gate with teeth. Submission is from App Store Connect once a build
is uploaded; review is typically 24–48 hours and a rejection costs a
resubmission, not a re-review of everything.

Everything the listing needs — description, keywords, screenshots, the privacy
answers, the age rating, and **the demo account App Review must be given** — is
in [`../product/store-listing.md`](../product/store-listing.md). Fill that in
before you open the submission form; doing it in the form is how a placeholder
ships.

### What will get these two apps rejected

These are not hypothetical. They are the guidelines that bite an app in this
shape.

**Background location without a visible reason (Guideline 2.5.4).** The driver
app requests *Always* location and runs with the screen off. Review will ask
why, and the answer has to be demonstrable in the app: the position is reported
only while a ride is under way, and the app says so on screen while it is
happening. Point them at the ride screen in the review notes. An app that keeps
the location indicator lit with no active job is the version that gets
rejected, and rightly.

**The permission strings.** `NSLocationWhenInUseUsageDescription` and
`NSLocationAlwaysAndWhenInUseUsageDescription` are already written in the first
person and say what is shared, with whom, and for how long. Do not shorten
them to "This app needs your location" — that is both a rejection and the
sentence people decline.

**The privacy manifest (mandatory since May 2024).**
`PrivacyInfo.xcprivacy` exists in both targets and is in the Resources build
phase, which is the part people miss: a manifest that is not in the build phase
is not in the bundle, and the app is rejected as though it had none. It
declares no tracking and no tracking domains — true here, because the app talks
to the CareBridge API and nothing else. If a third-party SDK is ever added,
this file is a thing that has to change.

**The privacy answers must match the manifest.** App Store Connect asks the
same questions again in a form, and an app whose nutrition label says it
collects no location while its manifest declares precise location is rejected
for the inconsistency. `store-listing.md` holds one set of answers so that the
two cannot drift.

**Sign in with Apple (Guideline 4.8).** Required *only* if you offer a
third-party social login. CareBridge uses email and password, so it does not
apply — and adding "Sign in with Google" later would make it apply, which is
worth knowing before someone adds it as a convenience.

**Account deletion (Guideline 5.1.1(v)).** An app that lets a user create an
account must let them delete it **from inside the app** — not by emailing
support. Check this against the current settings screen before submitting; it
is a rejection that surprises people because the requirement is newer than most
apps.

**Health data.** These apps are not HealthKit apps and should not become ones.
The listing must not imply diagnosis, treatment, or medical advice — CareBridge
coordinates appointments and transport, as `docs/product/non-goals.md` says at
more length. Keep that wording in the description.

**Encryption / export compliance.** The app uses HTTPS and the Keychain and
nothing else, which is the standard exemption. Declaring it once in
`Info.plist` stops TestFlight asking on every single upload:

```xml
<key>ITSAppUsesNonExemptEncryption</key>
<false/>
```

**Demo account.** Review will not sign up for a transport service. They need
credentials that reach a populated account, and for the driver app an account
with an assigned job — otherwise they open it, see an empty shift, and reject
it as non-functional. This is the single most common rejection for an app like
this one, and it is entirely preventable.

---

## Versioning

`version: 0.1.0+1` in `pubspec.yaml` feeds both iOS fields:
`CFBundleShortVersionString` = `0.1.0` (what users see) and `CFBundleVersion`
= `1` (what App Store Connect uniques on). **Every upload needs a higher build
number**, even a re-upload of an identical binary, so the number after the `+`
is what you increment. Reusing one is rejected at upload, which is at least a
fast failure.

---

## Checklist

- [ ] Apple Developer Program membership active
- [ ] Both bundle ids registered; app records created
- [ ] Driver app: Background Modes → Location updates capability ticked
- [ ] Signing team selected on both targets
- [ ] `ITSAppUsesNonExemptEncryption` set, so uploads stop asking
- [ ] Built with `--dart-define=CAREBRIDGE_API_BASE_URL=https://…`
- [ ] Pointed at a **production** API, not staging, for a store build
- [ ] Build number incremented
- [ ] `PrivacyInfo.xcprivacy` present in Runner → Build Phases → Copy Bundle Resources
- [ ] Privacy answers in App Store Connect match the manifest
- [ ] Account deletion reachable in-app
- [ ] Demo account works, and the driver demo account has a job on it
- [ ] Review notes explain the background location, with a screen to look at
