# End-to-end tests: real Stash v0.32.0 + real plugin builds

Starts the Stash binary with a throwaway home (`.stash-home/`) and drives scene pages in Chromium. Assertions are made on what the device would actually receive: the uploaded CSV and the `hssp/setup` call.

| Real | Faked (`lib/mocks.mjs`) |
|---|---|
| Stash server and UI, SIT fork build, (optional) unmodified SIT build, this plugin's build, settings persistence (`config.yml`) | all of handyfeeling.com (Handy API v2 and CSV upload; nothing leaves the machine), the script list from SIT's Python `init` task |

## Running

```bash
npm install
STASH_BIN=/path/to/stash-macos \
E2E_SIT_LEGACY_DIST=/path/to/unmodified-SIT/dist \
E2E_CHROME=/path/to/chrome-headless-shell \
npx playwright test
```

- Build this plugin first (`npm run build` in the repository root).
- Build the SIT fork ([royalark/StashInteractiveTools](https://github.com/royalark/StashInteractiveTools), branch `feat/extension-api`, `npx rollup -c`). It is looked up at `../StashInteractiveTools/dist` next to this repository, or set `E2E_SIT_DIST`.
- Without `E2E_SIT_LEGACY_DIST`, the "unmodified SIT" scenarios are skipped.
- Without `E2E_CHROME`, Playwright's downloaded browser is used.
- Test videos are generated with ffmpeg (libvpx, libopus).
