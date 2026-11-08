/**
 * The three things this project's generated `android/` directory needs, applied by
 * prebuild instead of by hand.
 *
 * `android/` is git-ignored and rewritten from scratch by `expo prebuild`, so every
 * hand edit made after a prebuild is a trap: the next prebuild silently drops it.
 * That has already cost this project two builds — a clean prebuild put
 * `reactNativeArchitectures` back to all four ABIs and the heap back to 2 GB, and it
 * dropped the property Google Mobile Ads reads. This plugin is where those edits
 * live now, so `npx expo prebuild` produces a correct project on its own.
 *
 * ## 1. `debuggable true` on the release build type — only with a Test Store key
 *
 * RevenueCat's SDK refuses to run a Test Store key in a build that is not
 * debuggable: it logs, shows an alert, and crashes on purpose, so that a Test Store
 * build can never reach a store by accident. "Debuggable" is the manifest flag —
 * `DefaultIsDebugBuildProvider` in purchases-android 10.24.0 reads
 * `context.applicationInfo.flags` — so a normal `assembleRelease` build trips it.
 *
 * That is exactly this app's shipping mode: a debug-signed sideload sold from our
 * own tunnel, with no store listing to use a real `goog_…` key with. So when
 * `EXPO_PUBLIC_REVENUECAT_KEY` is a `test_…` key, the release build type is marked
 * debuggable and the SDK starts. When a real key is configured, the flag is **not**
 * added and the build stays an ordinary release build — the behaviour follows the
 * key rather than a comment someone has to remember.
 *
 * This does not turn on React Native's dev support: that follows
 * `ReactBuildConfig.DEBUG`, which is generated per build type ("release" here), so
 * the app still loads the JS bundle packaged in the APK and never asks for Metro.
 *
 * ## 2 and 3. The Gradle properties
 *
 * `reactNativeArchitectures` and the heap size are what the README used to tell you
 * to restore by hand, and `RNGMA_ANDROID_BACKEND` is read by
 * react-native-google-mobile-ads before it falls back to a `rootProject.ext` lookup
 * an Expo project never defines — without it that module fails to configure and the
 * build stops before it starts.
 */

const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

/** The marker that makes a second run a no-op, and says why the line is there. */
const MARKER = 'debuggable true // OnMe: Test Store key, see plugins/with-test-store-android.js';

/** Whether this build is being made with a Test Store key. */
function usingTestStore() {
  return (process.env.EXPO_PUBLIC_REVENUECAT_KEY ?? '').trim().startsWith('test_');
}

/** Reads the key at prebuild time, when this file runs. */
function withTestStoreRelease(config) {
  if (!usingTestStore()) return config;

  return withAppBuildGradle(config, (cfg) => {
    const gradle = cfg.modResults;
    if (gradle.language !== 'groovy' || gradle.contents.includes(MARKER)) return cfg;

    const release = /(\n([ \t]*)release \{)/;
    if (!release.test(gradle.contents)) {
      throw new Error(
        'with-test-store-android: could not find the release build type in android/app/build.gradle'
      );
    }

    gradle.contents = gradle.contents.replace(
      release,
      (_match, block, indent) => `${block}\n${indent}    ${MARKER}`
    );
    return cfg;
  });
}

function withOnMeGradleProperties(config) {
  return withGradleProperties(config, (cfg) => {
    const wanted = {
      // One ABI: this APK is sideloaded onto an arm64 phone, and four ABIs would
      // quadruple the download for nothing.
      reactNativeArchitectures: 'arm64-v8a',
      // The default 2 GB runs out against three native SDKs plus the JS bundler.
      'org.gradle.jvmargs': '-Xmx3072m -XX:MaxMetaspaceSize=512m',
      // "classic" is the module's own default; the lookup it falls back to is not.
      RNGMA_ANDROID_BACKEND: 'classic',
    };

    for (const [key, value] of Object.entries(wanted)) {
      const existing = cfg.modResults.find((entry) => entry.type === 'property' && entry.key === key);
      if (existing) existing.value = value;
      else cfg.modResults.push({ type: 'property', key, value });
    }
    return cfg;
  });
}

module.exports = function withTestStoreAndroid(config) {
  return withOnMeGradleProperties(withTestStoreRelease(config));
};
