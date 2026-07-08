# Capsule → native mobile app (Capacitor)

> **Just want friends to try it on their phones?** You probably don't need this.
> Use **File → Export → Single-file HTML** — one `.html` you text/AirDrop that
> opens straight from Files/Safari, no hosting or install. Native (below) is only
> for shipping a real App Store / Play Store app, and **iOS requires a Mac + Xcode
> + a paid Apple Developer account** — you can't sideload an app from a file on iOS.

Wraps a capsule (plain HTML/JS/three.js) into native **iOS** and **Android** apps. Capacitor is
framework-agnostic — it wraps any web app, so plain three.js works. npm lives only here; the game
stays dependency-free. (Games already *play* in any mobile browser — this is for shipping a real app.)

## Usage

```bash
./mobile-export/build.sh [ios|android|both] [--capsule DIR] [--cdn]
```

It stages the game into `www/`, vendors three.js locally (offline — App Store builds shouldn't
fetch a CDN; pass `--cdn` to skip), writes `capacitor.config.json`, installs Capacitor, adds the
platform(s), and runs `cap sync`. Then:

- **iOS** — open `mobile-export/ios/App/App.xcworkspace` in **Xcode**, pick a device/simulator, Run.
  (Needs macOS + Xcode + CocoaPods.)
- **Android** — open `mobile-export/android/` in **Android Studio**, Run. (Needs Android Studio + JDK.)

Set the app id/name via env: `CAPSULE_APP_ID=com.you.game CAPSULE_APP_NAME="My Game" ./mobile-export/build.sh`.

## After editing the game

Re-run `./mobile-export/build.sh` (or just `npx cap sync` from here) to push web changes into the
native projects — no need to re-add platforms.

## Touch controls

Mobile has no keyboard. On-screen touch input (a look-drag + a joystick) is **game code** — ask the
AI box to add it, or wire `pointerdown/move` on the canvas. The wrapper doesn't change controls.
