# Signed Releases and Rollback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The updater installs only releases signed with Briii's Ed25519 key, and *Briii: Install Previous Version…* rolls back to the previous signed release and holds the bad one back.

**Architecture:** CI signs the `.sha256` asset's bytes (`scripts/sign-release.mjs`, key from the GitHub environment `release`) and self-checks against the public keys shipped in `briii-update/lib/releaseKeys.js`. The updater verifies the signature and the signed file name (`lib/signature.js`) before trusting the hash. Rollback reuses the download and helper paths; `state.json` gains `heldBack` and a `rollback` flag on `pending`.

**Tech Stack:** Node built-in `crypto` (Ed25519, no dependencies), plain-JS VS Code extension, `node:test`, PowerShell 5.1 workflow steps.

**Spec:** `docs/superpowers/specs/2026-11-26-signed-releases-rollback-design.md`

## Global Constraints

- No new dependencies; Node's `crypto` only (`crypto.sign(null, …)` / `crypto.verify(null, …)` with Ed25519 keys).
- Signed content: the exact bytes of `BriiiCode-Setup-x64-<id>.exe.sha256` (`<sha256>  BriiiCode-Setup-x64-<id>.exe\n`).
- Signature asset name: `BriiiCode-Setup-x64-<id>.exe.sha256.sig`; content: base64 of the 64-byte signature, one line.
- Keys: PEM strings, private PKCS#8, public SPKI. Secret name `BRIII_SIGNING_KEY`, environment `release`.
- Test hooks honoured only while `BRIII_UPDATE_FEED` is set: `BRIII_UPDATE_TEST_KEY` (SPKI PEM), `BRIII_UPDATE_RELEASES` (release list URL).
- Release list URL: `https://api.github.com/repos/<briiiUpdateRepo>/releases?per_page=10`.
- Command id `briii.update.installPrevious`, title `Install Previous Version…`, category `Briii`.
- Copy (exact): none found → `No earlier signed release is available.`; modal → `Install Briii Code <prev> instead of <current>? <current> won't be installed again; updates resume with the next newer release.`; buttons `Restart and Install`, `Install on Close`.
- CI keeps the newest 3 releases.
- `briii-update` stays plain JS (no build step); `test/` isn't shipped. PowerShell 5.1 rules from CLAUDE.md apply (no BOM, edit UTF-8 with the editor tools).

## Review Focus

1. A `.sig` with a trailing newline or CRLF (edited or re-uploaded by hand) must still verify: trim before base64 decode. → Task 1 test `verifySignedSha accepts a signature with trailing whitespace`.
2. A release list containing tags that don't parse as Briii ids (a stray tag, a `-local` id) must be skipped, not crash the command. → Task 2 test `fetchPrevious skips releases whose tag is not a Briii id`.
3. The user installs a newer build by hand while a version is held back: the hold must clear once the running build is newer than `heldBack`. → Task 3 test `checkForUpdate: heldBack older than the running build is cleared`.
4. Rollback chosen while a normal update is pending: the rollback replaces it, and the newer installer file is deleted. → Task 3 test `prepareRollback replaces a pending update`.
5. The secret and the shipped public key differ: CI must fail before publishing. → Task 1 test `--verify fails for a signature by a key not in releaseKeys.js`.

---

## File Structure

- Create `brand/extensions/briii-update/lib/signature.js`: verifies a signed `.sha256` text; returns the trusted hash.
- Create `brand/extensions/briii-update/lib/releaseKeys.js`: shipped public keys + `trustedKeys(env)`.
- Create `scripts/sign-release.mjs`: `--generate <dir>`, `<sha-file>` (sign), `--verify <sha-file>`.
- Modify `brand/extensions/briii-update/lib/feed.js`: `.sig` required; verification in `downloadVerified`; new `fetchPrevious`.
- Modify `brand/extensions/briii-update/lib/state.js`: `heldBack` default.
- Modify `brand/extensions/briii-update/lib/updater.js`: `keys` threaded through; hold-back and rollback rules; new `prepareRollback`.
- Modify `brand/extensions/briii-update/lib/exitInstall.js`: `rollback` input.
- Modify `brand/extensions/briii-update/extension.js` and `package.json`: command, keys, stale-pending rule.
- Modify `brand/extensions/briii-update/test/helpers.js`: signed fake feed, `/releases` list.
- Modify `scripts/smoke/index.js`: signed feed, bad-signature check, rollback check.
- Modify `.github/workflows/release.yml`: environment, sign + self-check, keep 3, new tests.
- Modify `CLAUDE.md` (local, gitignored): commands and auto-update gotchas.

---

### Task 1: Signature verification, release keys and the signing script

**Files:**
- Create: `brand/extensions/briii-update/lib/signature.js`, `brand/extensions/briii-update/lib/releaseKeys.js`, `scripts/sign-release.mjs`
- Test: `brand/extensions/briii-update/test/signature.test.js`, `scripts/test/sign-release.test.mjs`

**Interfaces:**
- Produces:
  - `verifySignedSha(shaBytes: Buffer, sigText: string, id: string, keys: string[]) -> string` (lower-case hex hash). Throws `Error` whose message starts with `signature check failed:` and names the reason (`no valid signature`, `signed for <name>, expected <name>`, `unreadable checksum file`).
  - `PUBLIC_KEYS: string[]`; `trustedKeys(env = process.env) -> string[]` = `PUBLIC_KEYS` plus `env.BRIII_UPDATE_TEST_KEY` when both it and `env.BRIII_UPDATE_FEED` are non-empty.
  - CLI: `node scripts/sign-release.mjs --generate <dir>` writes `<dir>/private.pem`, `<dir>/public.pem`, prints the public PEM; `node scripts/sign-release.mjs <sha-file>` writes `<sha-file>.sig` from `BRIII_SIGNING_KEY`; `node scripts/sign-release.mjs --verify <sha-file> [--keys <public.pem>]` exits 0 when `<sha-file>.sig` verifies against `releaseKeys.js` (or the given key file), non-zero with a message otherwise. Exit code 2 when `BRIII_SIGNING_KEY` is missing or empty. The `--verify` path reuses `verifySignedSha` (load with `createRequire`), passing the id parsed from the file name in the sha file.

- [ ] **Step 1: Write the failing unit tests** in `test/signature.test.js`. Generate a key pair per file with `crypto.generateKeyPairSync('ed25519')` exported as PEM; a helper `signed(id, hash)` returns `{ bytes, sig }` for `` `${hash}  BriiiCode-Setup-x64-${id}.exe\n` ``.
  - `verifySignedSha returns the signed hash` → equals the hash.
  - `verifySignedSha accepts a signature with trailing whitespace` → `sig + '\r\n'` still returns the hash.
  - `verifySignedSha rejects a tampered checksum file` → one changed hex digit throws `/no valid signature/`.
  - `verifySignedSha rejects a signature by an unknown key` → throws `/no valid signature/`.
  - `verifySignedSha rejects a file signed for another release` → signed for id A, checked as id B, throws `/signed for BriiiCode-Setup-x64-A\.exe/`.
  - `verifySignedSha accepts any key in the list` → keys `[other, right]` passes.
  - `trustedKeys adds the test key only with a test feed` → `{BRIII_UPDATE_TEST_KEY: k}` gives `PUBLIC_KEYS`; `{BRIII_UPDATE_TEST_KEY: k, BRIII_UPDATE_FEED: 'http://x'}` gives `[...PUBLIC_KEYS, k]`.
- [ ] **Step 2: Run** `node --test brand/extensions/briii-update/test/signature.test.js`. Expected: FAIL, `Cannot find module '../lib/signature'`.
- [ ] **Step 3: Implement `lib/signature.js` and `lib/releaseKeys.js`.** `PUBLIC_KEYS` starts as `[]`; Step 7 fills it. Parse the signed text with `.trim().split(/\s+/)`: two fields, a 64-char hex hash and the file name.
- [ ] **Step 4: Run** the same command. Expected: 7 passing.
- [ ] **Step 5: Write `scripts/test/sign-release.test.mjs`** (spawn the script with `process.execPath`, temp dir per test, removed on exit):
  - `--generate writes a key pair` → both files exist and start with `-----BEGIN`.
  - `signs and verifies with the generated key` → sign with `BRIII_SIGNING_KEY=<private.pem>`, then `--verify --keys public.pem` exits 0.
  - `--verify fails for a tampered file` → exit non-zero after changing the sha file.
  - `--verify fails for a signature by a key not in releaseKeys.js` → no `--keys`: exit non-zero, stderr matches `/no valid signature/`.
  - `signing without BRIII_SIGNING_KEY exits 2` → exit code 2, no `.sig` written.
- [ ] **Step 6: Implement `scripts/sign-release.mjs`**; run `node --test scripts/test/sign-release.test.mjs`. Expected: 5 passing.
- [ ] **Step 7: Generate the production key pair** outside the repo: `node scripts/sign-release.mjs --generate "%USERPROFILE%\briii-signing"`. Put the printed public PEM into `PUBLIC_KEYS`. Check: `git status` shows no `.pem` file; `node --test` on both test files still passes.
- [ ] **Step 8: Commit** `lib/signature.js`, `lib/releaseKeys.js`, `scripts/sign-release.mjs`, both tests: `Release signing: Ed25519 verification, shipped key, signing script`.

### Task 2: Signed feed and previous-release lookup

**Files:**
- Modify: `brand/extensions/briii-update/lib/feed.js`, `brand/extensions/briii-update/test/helpers.js`
- Test: `brand/extensions/briii-update/test/feed.test.js`

**Interfaces:**
- Consumes: `verifySignedSha`, `trustedKeys` (Task 1).
- Produces:
  - release object `{ id, installerUrl, shaUrl, sigUrl, pageUrl }` (`toLatest` returns `null` without the `.sig` asset);
  - `downloadVerified(release, dir, { timeoutMs, keys = trustedKeys() })` (same return; checks per the spec's order);
  - `fetchPrevious(listUrl: string, current: string) -> Promise<release | null>`: newest release with `isNewer(current, id)`, tags that `parseRelease` rejects are skipped.
  - helpers: `TEST_KEYS = { privateKey, publicKey }` (PEM, generated once per process); `startFeed({ id, …, badSig = false, unsigned = false, releases = [] })` signs with `TEST_KEYS` (`badSig` signs other bytes; `unsigned` omits the asset) and serves `/releases` as a JSON array of release objects for `[id, ...releases]` ids, each with its own assets served from the same bytes.

- [ ] **Step 1: Update existing feed tests** to pass `{ keys: [TEST_KEYS.publicKey] }` to `downloadVerified`, and add:
  - `fetchLatest returns null when the release has no signature asset` (`unsigned: true`).
  - `downloadVerified rejects a bad signature and leaves nothing behind` → rejects `/signature check failed/`, no `.exe` or `.part` in the dir, `/blob` not requested (`hits['/blob']` undefined).
  - `downloadVerified rejects a feed signed by an unknown key` → keys `[otherPublic]`, rejects `/no valid signature/`.
  - `fetchPrevious picks the newest older signed release` → current `…20261126.0088`, releases `…0087`, `…0081` plus newer `…0090`: returns `…0087`.
  - `fetchPrevious skips releases whose tag is not a Briii id` → list with `vjunk` and `1.143.17232-local` plus `…0081`: returns `…0081`.
  - `fetchPrevious returns null when nothing older is listed`.
- [ ] **Step 2: Run** `node --test brand/extensions/briii-update/test/feed.test.js`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** in `feed.js` and `helpers.js`. Download the `.sha256` and `.sig` before the installer; `fetchPrevious` sends the same headers as `fetchLatest` (no ETag) and maps with `toLatest`. Thread `keys` through `updater.js`: `checkForUpdate({ feedUrl, dir, current, mode, keys })` passes `{ keys }` to `downloadVerified`; existing `updater.test.js` calls pass `keys: [TEST_KEYS.publicKey]`.
- [ ] **Step 4: Run** all `briii-update` tests: `node --test "brand/extensions/briii-update/test/*.test.js"`. Expected: all pass.
- [ ] **Step 5: Commit** `feed.js`, `updater.js`, `helpers.js`, `feed.test.js`, `updater.test.js`: `Updater: require a valid signature; find the previous release`.

### Task 3: Hold-back, rollback pending and install-on-exit rules

**Files:**
- Modify: `brand/extensions/briii-update/lib/state.js`, `lib/updater.js`, `lib/exitInstall.js`
- Test: `test/updater.test.js`, `test/exitInstall.test.js`

**Interfaces:**
- Consumes: Task 2's `downloadVerified`, `fetchPrevious`, `TEST_KEYS`.
- Produces:
  - state shape `{ pending: { id, path, sha256, rollback? } | null, failures, lastCheck, heldBack: string | null, feed? }` (`DEFAULT` adds `heldBack: null`);
  - `prepareRollback({ listUrl, dir, current, keys }) -> Promise<{ status: 'none' } | { status: 'ready', id } | { status: 'failed', error }>`: finds with `fetchPrevious`, downloads, writes `pending = { id, path, sha256, rollback: true }`, `failures = 0`, `heldBack = current`;
  - `isStalePending(pending, current) -> boolean` (exported from `updater.js`, used by `extension.js`): non-rollback and not newer than current; or rollback whose id is not older than current.
  - `shouldInstallOnExit({ …, rollback })`: a rollback pending installer older than current passes the version condition.

- [ ] **Step 1: Write failing tests** in `updater.test.js`:
  - `checkForUpdate: a release not newer than heldBack is no update` → heldBack = feed id, current older: `status 'none'`, no download (`hits['/blob']` undefined).
  - `checkForUpdate: a release newer than heldBack replaces a pending rollback and clears the hold` → starts with a rollback pending and heldBack older than the feed id: afterwards `pending.id` is the feed id, `pending.rollback` is falsy, `heldBack` is `null`.
  - `checkForUpdate: heldBack older than the running build is cleared` → state heldBack older than current, feed = current: `heldBack` becomes `null`.
  - `checkForUpdate: a rollback pending installer older than the running build is kept`.
  - `checkForUpdate: a rollback pending installer is dropped once it is the running build`.
  - `prepareRollback prepares the previous release and holds the current one` → state `pending.rollback === true`, `pending.id === previous`, `heldBack === current`, file exists.
  - `prepareRollback replaces a pending update` → pending newer installer path no longer exists afterwards.
  - `prepareRollback reports none when no older release is listed` → `status 'none'`, state unchanged.
  - `prepareRollback leaves state unchanged when the signature is bad` → `status 'failed'`.

  In `exitInstall.test.js`:
  - `a rollback older than the running build installs on close` (`pendingId` older, `rollback: true`).
  - `an older installer that is not a rollback never installs`.
- [ ] **Step 2: Run** `node --test "brand/extensions/briii-update/test/*.test.js"`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** in `state.js`, `updater.js`, `exitInstall.js`. Replace `check()`'s stale-pending condition with `isStalePending`; `prepareRollback` shares the `inflight` map key `dir`.
- [ ] **Step 4: Run** all `briii-update` tests. Expected: all pass.
- [ ] **Step 5: Commit**: `Updater: rollback pending installers and holding back a version`.

### Task 4: The command, wiring and smoke tests

**Files:**
- Modify: `brand/extensions/briii-update/extension.js`, `brand/extensions/briii-update/package.json`, `scripts/smoke/index.js`

**Interfaces:**
- Consumes: `trustedKeys` (Task 1), `checkForUpdate`/`prepareRollback`/`isStalePending` (Task 3), `shouldInstallOnExit` with `rollback` (Task 3).
- Produces: command `briii.update.installPrevious`; it returns the `prepareRollback` result (the smoke test reads it); with `BRIII_UPDATE_FEED` set it skips the modal and returns after preparing (test mode, like *Install Now*'s `mayRunInstaller`).

- [ ] **Step 1: Write the failing smoke checks** in `scripts/smoke/index.js`: the `feed()` helper signs with a key pair generated at the top of the updater section and sets `process.env.BRIII_UPDATE_TEST_KEY` (restored in `finally`); it also serves `/releases`. Checks:
  - `updater: rejects a bad signature` → `briii.update.check` returns `status 'failed'` with `/signature check failed/`.
  - `updater: Install Previous Version prepares an older signed release` → with `BRIII_UPDATE_RELEASES` pointing at `/releases` listing an id older than the running build (`0.0.00000-20000101.1`), the command returns `status 'ready'`, and `state.json` has `pending.rollback === true` and `heldBack` equal to the running release.
- [ ] **Step 2: Implement** in `extension.js`: `releasesUrl()` (test hook per Global Constraints), keys from `trustedKeys()` into `checkForUpdate`; `finishPreviousInstall` uses `isStalePending`; `deactivate` passes `rollback: !!state.pending?.rollback`; the command per the spec (progress notification while downloading; modal with the exact copy; *Restart and Install* reuses `startHelper(pending, true)` + quit; *Install on Close* sets `installRequested`; `effectiveMode` returning a non-writable reason → the same message as silent updates). `installNow`'s `isNewer` guard must allow a rollback pending installer. Add the command to `package.json`.
- [ ] **Step 3: Unit tests still pass**: `node --test "brand/extensions/briii-update/test/*.test.js"`.
- [ ] **Step 4: Build and verify**: `.\scripts\build.ps1 -Version 1.143.17232`, then `.\scripts\verify.ps1 -AppDir .cache\stage\1.143.17232` (clear `ELECTRON_RUN_AS_NODE` first). Expected: `All checks passed.`, including both new updater checks.
- [ ] **Step 5: Commit** `extension.js`, `package.json`, `scripts/smoke/index.js`: `Briii: Install Previous Version (signed rollback with hold-back)`.

### Task 5: CI signing, three releases, docs

**Files:**
- Modify: `.github/workflows/release.yml`, `CLAUDE.md`

**Interfaces:**
- Consumes: `scripts/sign-release.mjs` (Task 1).

- [ ] **Step 1: Edit the workflow:**
  - job: `environment: release`;
  - "Test built-in extensions": add `scripts/test/sign-release.test.mjs` to the `node --test` line;
  - Publish: after writing the `.sha256`, run `node scripts/sign-release.mjs "$exe.sha256"` with `env: BRIII_SIGNING_KEY: ${{ secrets.BRIII_SIGNING_KEY }}`, then `node scripts/sign-release.mjs --verify "$exe.sha256"`, each followed by `if ($LASTEXITCODE) { exit $LASTEXITCODE }`; upload `"$exe.sha256.sig"` with the other two assets;
  - "Keep only the newest release" → "Keep the newest 3 releases", jq slice `.[3:]`, comment updated (rollback needs the older two).
- [ ] **Step 2: Check the YAML parses**: `node -e "require('fs').readFileSync('.github/workflows/release.yml','utf8')"` plus a review of indentation; `git diff` shows only the intended changes.
- [ ] **Step 3: Update CLAUDE.md**: the new test command; in the auto-update gotchas, signing (assets, `release` environment, self-check, key backup, a lost key needs one manual install), rollback (command, `heldBack`, 3 releases, test hooks `BRIII_UPDATE_TEST_KEY`/`BRIII_UPDATE_RELEASES`); the roadmap note that releases keep 3.
- [ ] **Step 4: Commit** the workflow: `CI: sign releases (release environment), keep the newest 3`.

### Task 6: Rollout (with the user)

- [ ] **Step 1: The user creates the environment:** GitHub → repo Settings → Environments → New environment `release` → Deployment branches: *Selected branches* → `main`; add secret `BRIII_SIGNING_KEY` = the full contents of `%USERPROFILE%\briii-signing\private.pem`; save a backup in a password manager.
- [ ] **Step 2: Delete the local private key** once the user confirms the backup: remove `%USERPROFILE%\briii-signing\private.pem`.
- [ ] **Step 3: Push** `main`. Expected: the release workflow succeeds, and the new release lists three assets, including `….exe.sha256.sig`.
- [ ] **Step 4: Check the published signature** locally: download the release's `.sha256` and `.sig` and run `node scripts/sign-release.mjs --verify <file>`. Expected: exit 0.
