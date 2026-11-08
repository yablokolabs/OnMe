/**
 * The privacy policy the Google Play listing links to, served at `/privacy`.
 *
 * It lives next to the code it describes, so a change to what the backend does
 * with a photo and a change to what the policy says are made in the same place.
 */

const UPDATED = '8 November 2026';

export const PRIVACY_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OnMe privacy policy</title>
<style>
  body { font: 16px/1.55 system-ui, sans-serif; max-width: 42rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; color: #1b1530; background: #fff; }
  h1 { font-size: 1.6rem; } h2 { font-size: 1.15rem; margin-top: 2rem; }
  @media (prefers-color-scheme: dark) { body { color: #eee; background: #0b0620; } a { color: #c9b6ff; } }
</style>
</head>
<body>
<h1>OnMe privacy policy</h1>
<p>Last updated: ${UPDATED}</p>

<p>OnMe is an Android app made by <strong>Yabloko Labs Ltd</strong>, a company registered in England and Wales
(company number 16660148), 71-75 Shelton Street, Covent Garden, London, WC2H 9JQ, United Kingdom.
Yabloko Labs Ltd is the data controller. Contact: <a href="mailto:support@yablokolabs.com">support@yablokolabs.com</a>.</p>

<h2>What OnMe does</h2>
<p>You choose a photo of yourself and a photo of an outfit. OnMe makes one picture of you wearing the outfit.
OnMe has no accounts and no sign-in.</p>

<h2>Your photos</h2>
<ul>
  <li>When you tap "See it on you", the two photos go over an encrypted connection to the OnMe server, and from there
  to Modal Labs, Inc. (United States), which runs the try-on model on a rented GPU.</li>
  <li>The OnMe server writes no photo to disk. It holds the photos in memory while the picture is made, and then
  drops them. It holds the finished picture in memory for at most 10 minutes, until your phone downloads it.</li>
  <li>The OnMe code on Modal holds the photos in memory only to make the picture, and writes no copy of them.</li>
  <li>Your photo, your outfits and your looks are kept only on your phone. You can delete each of them, or everything,
  in Settings. Uninstalling the app also deletes them.</li>
  <li>We do not use your photos to train any model, and we do not sell or share them.</li>
</ul>

<h2>Ads</h2>
<p>When your free pictures are used up, you can choose to watch a video ad for one more picture. The ads come from
Google AdMob (Google LLC). AdMob collects device information, such as the advertising ID, IP address and ad
interactions, to show and measure ads. In the UK, the EU and Switzerland, OnMe asks for your consent first, and you can
change your choice at any time in Settings &rsaquo; Privacy choices. See
<a href="https://policies.google.com/technologies/partner-sites">how Google uses information from apps that use its services</a>.
No ad is shown unless you choose to watch one.</p>

<h2>Reports</h2>
<p>You can report a picture from the look screen. A report sends the reason you choose, the name of the model and an
optional note you type. It sends no picture and no photo. Reports are kept in the server log for up to 30 days.</p>

<h2>Server logs</h2>
<p>The OnMe server logs the size of each photo, how long each picture took, and errors. It does not log photos, names
or the contents of a picture. Logs are kept for up to 30 days.</p>

<h2>Who can use OnMe</h2>
<p>OnMe is for adults aged 18 and over. Use only photos of yourself, or of someone who has agreed to it.</p>

<h2>Your rights</h2>
<p>Under the UK GDPR you can ask what data we hold about you, ask us to correct or delete it, and object to its use.
Because OnMe has no accounts and keeps no photos, we usually hold nothing that identifies you. Write to
<a href="mailto:support@yablokolabs.com">support@yablokolabs.com</a>. You can also complain to the Information
Commissioner's Office (<a href="https://ico.org.uk">ico.org.uk</a>).</p>

<h2>Changes</h2>
<p>If this policy changes, the new version is published at this address with a new date.</p>
</body>
</html>
`;
