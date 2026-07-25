# Removing the publish freeze (after Apple creds confirmed)

The `publish-mac` job in `.github/workflows/release-mac.yml` is intentionally
gated with `if: ${{ false }}`. **Do not remove that gate** until all items below
are true.

`build-mac` is already runnable (signed dry-run). Only **publish** is frozen.

## Owner checklist (you)

- [x] Apple Developer account + Team ID confirmed (2026-07-25)
- [x] `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` current in
      `mac-release` environment
- [x] `CSC_LINK` / `CSC_KEY_PASSWORD` current in `mac-release`
- [ ] Developer ID Application certificate valid for `com.layernorm.overlay`
      (implied by green notarized dry-run; re-confirm Team ID / bundle ID)
- [ ] Notarization dry-run succeeded on a signed build from `mac-release`
      — track: https://github.com/LayerNorm/overlay-desktop/actions/workflows/release-mac.yml
- [ ] Gate A signed for the same source lineage

## Agent / release engineer checklist

- [ ] `build-mac` signed dry-run green on the candidate SHA
  - Prior green (earlier same day): run
    [30149739591](https://github.com/LayerNorm/overlay-desktop/actions/runs/30149739591)
    (SHA `d2215a38996800c2148e3cc9ac2bb3a61cca2e89`)
  - Current candidate: SHA `105cdae441582e5d50f4bf8ce3ca6b6dad9508f9` —
    run [30155922115](https://github.com/LayerNorm/overlay-desktop/actions/runs/30155922115)
- [ ] Nested signature / fuse / SBOM / native-helper verification green (same job)
- [x] [GATE_B_CLEAN_MAC_QA.md](./GATE_B_CLEAN_MAC_QA.md) prepared
- [ ] Change `publish-mac` `if: ${{ false }}` in a dedicated PR (see below)
- [ ] Update `scripts/check-release-security.mjs` + `check-launch-controls.mjs` in
      the **same** PR so they stop requiring the publish freeze after Gate B
- [ ] First public tag built from 40-char SHA only
- [ ] Website `OVERLAY_DESKTOP_DOWNLOADS_ENABLED=1` only **after** Gate B sign-off

## Exact workflow change (do not apply until checklists pass)

In `.github/workflows/release-mac.yml`, replace:

```yaml
  publish-mac:
    if: ${{ false }}
    needs: build-mac
```

with (publish still gated by `release-publish` environment reviewers):

```yaml
  publish-mac:
    needs: build-mac
```

Do **not** put signing secrets on the publish job. Keep `environment: release-publish`.

## Freeze removal PR template

1. Title: `release: unfreeze publish-mac after Gate B approval`
2. Body links:
   - Gate A checklist sign-off
   - Gate B checklist sign-off
   - Green signed dry-run URL + 40-char SHA
   - Clean Mac QA results
3. Required reviewers: CODEOWNERS release owners
4. Merge only with admin approval after QA PASS
5. Immediately after first successful publish, enable website downloads only if
   product/legal agree (`OVERLAY_DESKTOP_DOWNLOADS_ENABLED=1`)
