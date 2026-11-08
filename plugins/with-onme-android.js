/**
 * The Gradle properties this project's generated `android/` directory needs,
 * applied by prebuild instead of by hand.
 *
 * `android/` is git-ignored and rewritten from scratch by `expo prebuild`, so every
 * hand edit made after a prebuild is lost on the next one. This plugin is where
 * those edits live, so `npx expo prebuild` produces a correct project on its own.
 *
 *   - The default 2 GB heap runs out against the native SDKs plus the JS bundler.
 *   - `RNGMA_ANDROID_BACKEND` is read by react-native-google-mobile-ads before it
 *     falls back to a `rootProject.ext` lookup an Expo project never defines;
 *     without it that module fails to configure and the build stops.
 *
 * All four ABIs are built: Google Play splits the app bundle per device, so each
 * phone downloads only its own.
 */

const { withGradleProperties } = require('expo/config-plugins');

module.exports = function withOnMeAndroid(config) {
  return withGradleProperties(config, (cfg) => {
    const wanted = {
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
};
