# Changelog

All notable changes to Overlay Desktop are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

- Use an ephemeral signing keychain with its own password for macOS CI, and
  explain cloud dictation plan limits in the native controls.

- Add opt-in crash diagnostics, clamp floating panels after display changes, and
  allow a failed legacy export to retry while the web app still opens.

- Load the full web app by default with a versioned, origin-checked native bridge.
  Keep dictation, compact chat/notes panels, screenshots, notifications, local
  Agent Host controls and updates; retire duplicate chat/UI/provider code.
- Preserve legacy transcripts, preferences, recordings and knowledge files during
  upgrade. Cancel active microphone capture and native work on web sign-out.
- Exercise the sandboxed bridge and package the native app in macOS CI.

### Added

- Public history-free source repository at
  [LayerNorm/overlay-desktop](https://github.com/LayerNorm/overlay-desktop).
- Documented Ask for approval vs Full access host-execution modes.
- SUPPORT.md and expanded README for self-hosting, permissions, and troubleshooting.

### Security

- Removed fake runtime sandbox IPC that claimed isolation without providing it.
- Coding tools (`code_*`) execute via `execFile` argv arrays (no shell interpolation).
- Convex deployment URLs resolve from environment / build define only (no hardcoded slugs).
- Official website download APIs remain fail-closed until Gate B.

### Changed

- Canonical development remote is LayerNorm; private DevelopedByDev history is archived.
- Dependency batch: TipTap 3.29, groq-sdk 1.x, GitHub Actions release pins, Storybook 10.5.

## [0.1.23] - prior

Pre–public-source builds lived on private release infrastructure. Tags
`v0.1.19`–`v0.1.23` on the private `overlay-releases` repository were drafted
and are not the recommended public distribution channel.
