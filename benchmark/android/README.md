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

## Layer 2: real-world APK benchmark

The first external APK is [Markor](https://github.com/gsantner/markor), pinned to version 2.16.1. Markor is open source, works offline, requires no account, ships as a universal APK, and exposes realistic document creation and editing workflows. The installer downloads the APK from the official GitHub release and verifies its SHA-256 digest before installation.

```bash
npm run android:install:markor
```

The proposed first task is:

> Create a Markdown note named `actonce-benchmark.md`, enter `Replay this task without AI.`, save it, return to the file list, reopen it, and verify the content.

Before every measured run, the harness will clear Markor's app data and recreate a fixed fixture state. Onboarding belongs to environment setup, not the measured task. The Markor task runner will be added after the Settings smoke test has produced a successful Midscene report.

## Reproducibility contract

- Android API: 35
- image flavor: AOSP Automated Test Device (`aosp_atd`), which runs normal APKs but avoids unnecessary Google service weight
- AVD device profile: Pixel 6
- AVD name: `actonce_api35_atd`
- default emulator serial: `emulator-5554`
- userdata partition: 512 MB (sufficient for the benchmark APK and friendly to CI disks)
- animations: disabled after boot
- Markor: 2.16.1, SHA-256 `e88cdcced7aa3dca25e6b9c7a9bdcfad3e3988ee545be951f42bf9441b5e46bf`

The SDK, AVD, APK, runtime log, and repository-local JDK are stored under `.cache/` and are not committed.
