/**
 * `app.json`, with the AdMob App ID taken from the build environment.
 *
 * The App ID is public (it ships inside every APK), but it differs between a test
 * build and the Play build, so it is set per EAS profile as
 * `ONME_ADMOB_ANDROID_APP_ID`. Without one, the build uses Google's test App ID,
 * which serves only test ads. The production profile (the Play build) refuses to
 * build without the real App ID and rewarded unit, so it never ships test ads.
 */

const GOOGLE_TEST_ANDROID_APP_ID = 'ca-app-pub-3940256099942544~3347511713';

module.exports = ({ config }) => {
  const configured = (process.env.ONME_ADMOB_ANDROID_APP_ID ?? '').trim();
  const unit = (process.env.EXPO_PUBLIC_ADMOB_REWARDED_UNIT ?? '').trim();
  if (process.env.EAS_BUILD_PROFILE === 'production' && (configured === '' || unit === '')) {
    throw new Error(
      'The production build needs ONME_ADMOB_ANDROID_APP_ID and EXPO_PUBLIC_ADMOB_REWARDED_UNIT (eas.json, production env).'
    );
  }
  const androidAppId = configured || GOOGLE_TEST_ANDROID_APP_ID;
  return {
    ...config,
    plugins: config.plugins.map((plugin) =>
      Array.isArray(plugin) && plugin[0] === 'react-native-google-mobile-ads'
        ? [plugin[0], { ...plugin[1], androidAppId }]
        : plugin
    ),
  };
};
