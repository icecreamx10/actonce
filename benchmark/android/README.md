# Android benchmark environment

[English](README.md) | [简体中文](README.zh-CN.md)

The Android benchmark is split into two layers so infrastructure failures are not confused with APK-specific behavior.

## Layer 1: Midscene connection smoke test

The smoke test uses the Android Settings app included in the pinned emulator image. It opens Display settings, enables dark theme, and verifies the resulting UI state. This validates the complete emulator, ADB, screenshot, input-injection, Midscene, and model path without introducing a third-party APK.

```bash
npm run android:bootstrap
npm run android:start
npm run benchmark:android:midscene
```

Or run the last two commands together after setting the Midscene model environment variables:

```bash
npm run benchmark:android:smoke
```

Use `npm run android:start:headed` when visually debugging the emulator. `npm run android:start:foreground` keeps the owner shell alive, which is useful in process-isolated CI environments. Run `npm run android:stop` when finished.

## Layer 2: deterministic checkout benchmark

The primary fixture is Sauce Labs My Demo App Android 2.2.0 build 25. Its official release APK and SHA-256 are pinned in [`my-demo-app/fixture.json`](my-demo-app/fixture.json). The case selects a black backpack, sets quantity 3, verifies the `$ 89.97` cart, uses the built-in demo account, and stops on the prefilled shipping-address screen.

```bash
npm run android:install:demo-app
npm run benchmark:android:demo-app
```

The benchmark CLI resets app data outside measured time, runs the fixed `midscene-android` original once, resets again, and runs the native ActOnce replay once. Both results must independently pass the same live accessibility-tree oracle and save a final screenshot before their timings are comparable. The original must also contain two successful recorded Midscene assertions; replay reports fallback count and separates checkpoint capture time from settle delay.

Use `--mode original`, `--mode replay`, or `--mode evaluate` with the same `--output <directory>` to run the phases separately. A one-sample run is intended as a quick development benchmark; repeat it in independent output directories before publishing formal performance claims.

## Alternative document fixture

[Markor](https://github.com/gsantner/markor), pinned to version 2.16.1, remains an alternative document-editing fixture. It is open source, works offline, and requires no account.

```bash
npm run android:install:markor
npm run android:prepare:markor
```

The proposed first task is:

> Create a Markdown note named `actonce-benchmark.md`, enter `Replay this task without AI.`, save it, return to the file list, reopen it, and verify the content.

Before every measured run, the harness clears Markor's app data, grants its required storage app-op, completes onboarding by accessibility target, removes the benchmark note, and opens the Documents list. This setup is excluded from measured time.

With Midscene model variables configured, run the task with:

```bash
npm run benchmark:android:markor
```

## Reproducibility contract

- Android API: 35
- image flavor: standard Google APIs (`google_apis`), which exposes a real framebuffer for vision-driven automation
- GPU mode: software rendering (`swiftshader`) by default; override with `ACTONCE_EMULATOR_GPU` when needed
- AVD device profile: Pixel 6
- AVD name: `actonce_api35_google_apis`
- default emulator serial: `emulator-5554`
- shared user-level SDK: `~/Library/Android/sdk` when present; otherwise repository-local `.cache/android-sdk`
- shared user-level AVD directory: `~/.android/avd`
- animations: disabled after boot
- Markor: 2.16.1, SHA-256 `e88cdcced7aa3dca25e6b9c7a9bdcfad3e3988ee545be951f42bf9441b5e46bf`
- My Demo App: 2.2.0 build 25, SHA-256 `318ef64bdcaff18e576d962ab1f557e0a2683b9b5210a6bb6b25cb0caeef62b4`

APK caches, runtime logs, recordings, and repository-local fallbacks are not committed. The standard user-level SDK/AVD locations let Lynx, ActOnce, and other repositories share one emulator installation.
