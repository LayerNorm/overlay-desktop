# Overlay for Mac

The complete Overlay web app in a secure Electron shell, with native dictation,
floating chat and notes panels, screenshots, notifications, a local Agent Host
and automatic updates. Web features ship to desktop through the same app routes.

```sh
npm ci
npm run dev
```

Development defaults to the local web server. Set `APP_SERVER_URL` to the intended
HTTPS server (HTTP is accepted only for loopback development). The server profile
pins the origin used for navigation, permissions and the typed bridge. Remote
pages have no Node access. SSO opens in your normal browser and transfers a
one-time PKCE-bound session into the persistent app cookie partition.

Settings → Desktop configures native features. Default shortcuts are Option+Space
for dictation, Command+. for chat and Command+/ for notes. Local WhisperKit and
Parakeet models work offline after downloading; cloud dictation uses your Overlay
account and its existing billing checks. No provider key is stored in the desktop.

```sh
npm test
npm run build
npm run test:e2e
npm run security:verify:source
```

Playwright drives the actual Electron preload with throwaway profiles. Boundary
tests use a loopback fixture; the configured-server tests exercise real signed-out
web rendering and PKCE transfer navigation. Real Google sign-in, audio, screen
permissions and signed upgrade acceptance also require the release QA checklist.

`packages/overlay-desktop-bridge` is vendored from overlay-web. Keep its schemas
and fingerprint synchronized. Only the pinned top-level origin receives it; main
validates the caller, method and arguments again. Main contains no chat/agent
inference pipeline, provider SDK or direct Convex client. Agent Host enrollment is
user-initiated and server approval still gates filesystem access.

On upgrade, transcripts and native preferences are exported privately, while
recordings, knowledge files and migration journals remain on disk. Desktop settings
opens that folder. Legacy browser tabs/bookmarks and local assistant preferences
are retired. No local content is uploaded or deleted automatically.

Official macOS builds use the existing signed/notarized workflow and protected
release environments. Binary publication remains gated by the release checklist;
source validation alone does not approve publication. See [release process](guides/RELEASE_PROCESS.md)
and [security policy](SECURITY.md).
