# Releasing LightCraft

The release pipeline is [`.github/workflows/release.yml`](../.github/workflows/release.yml).
It runs on every push to the `release` branch. A maintainer can also dispatch it manually, with
an optional version override such as `1.2.0-rc.1`.

## Prepare and start a release

1. Merge the release-ready changes into `release`.
2. Set the workspace version in `Cargo.toml` (for example, with `cargo xtask version set 1.2.0`).
   For a manual workflow run, the version input can override the workspace version for that run.
   Use a semantic version such as `1.2.0` or `1.2.0-rc.1`; versions containing a hyphen are
   marked as prereleases.
3. Push to `release`, or dispatch the workflow.
4. Check the workflow run and its artifacts. On success, the workflow creates or updates a **draft**
   GitHub Release named `Rayfine <version>`.
   Review the draft and its `SHA256SUMS.txt`, then publish it in GitHub Releases when ready.

The workflow replaces assets when it updates an existing draft. It stops rather than overwriting a
release that has already been published, so bump the version before producing another release.

## Builds and artifacts

Release jobs build macOS Apple silicon (`aarch64-apple-darwin`) and Windows x64
(`x86_64-pc-windows-msvc`). The scripts write `dist/release/`:

- macOS: `lightcraft-<version>-macos-aarch64.dmg` and `lightcraft-cli-<version>-macos-aarch64.zip`
  (`packaging/macos/package.sh --arch aarch64`).
- Windows: `lightcraft-<version>-windows-x64.msi` and `lightcraft-<version>-windows-x64-portable.zip`
  (`packaging/windows/package.ps1 -Arch x64`).

The release job writes `SHA256SUMS.txt` and attaches everything to a draft. It updates an existing
draft and stops if that tag is already published.

Release builds fetch the pinned [`storytold/craft-fonts`](https://github.com/storytold/craft-fonts)
revision and require it (`CRAFT_FONTS_REQUIRED=1`). The pin lives in `packaging/fonts.sh` and
`packaging/windows/fonts.ps1`. A stale pin still builds, it just ships tofu (issue #319: v0.4.0 pinned a revision
from before Noto Sans CJK SC, so Simplified Chinese had no glyphs). Before a release, check the pin against
craft-fonts' `fonts/manifest.txt` and run `CRAFT_FONTS_DIR=../craft-fonts cargo test -p lightcraft-ui-egui i18n`,
whose glyph-coverage test checks the characters in available faces. `CRAFT_FONTS_REQUIRED=1` also makes
the native build fail if the pinned manifest lacks Noto Sans CJK SC Regular (`Hans`) or BIZ UDPGothic Regular.

Local macOS and Windows packaging scripts automatically use the sibling `../craft-fonts`
checkout. If it is absent, they clone it at revision
`3d9ab3a132ed0eff457e424226a435a901da30d3` (keep the pins in `packaging/fonts.sh` and
`packaging/windows/fonts.ps1` in sync with the release workflow). Existing checkouts are left untouched.
Set `CRAFT_FONTS_DIR` to use another
checkout; relative paths resolve from the workspace root. The script requires the Chinese and Japanese
UI faces and includes their OFL licences in the package. Download failures or incomplete checkouts
stop packaging with an error. `--skip-build` (`-SkipBuild` on Windows) packages existing binaries without downloading fonts or
changing what they embed; pass the same `CRAFT_FONTS_DIR` used to compile them so their licences ship.

## Signing credentials

All credentials are stored as secrets in the GitHub `release` environment. Signing is optional:
without platform signing credentials, packaging continues with unsigned artifacts and warnings.
macOS notarization is a separate optional step; when its credentials are absent, a build with a
signing identity is signed but not notarized. Configure only the platform credentials you need:

- **macOS signing:** `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, and `KEYCHAIN_PASSWORD`.
  **Notarization** additionally needs all of `APPLE_ID`, `APPLE_PASSWORD` (an app-specific
  password), and `APPLE_TEAM_ID`.
- **Windows signing:** either `WINDOWS_CERTIFICATE` and `WINDOWS_CERTIFICATE_PASSWORD`, or Azure
  Trusted Signing credentials: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`,
  `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, and `AZURE_CERT_PROFILE`.

The release job computes SHA-256 checksums for the artifact set and attaches `SHA256SUMS.txt` to the draft.
