# Signed releases and rollback

Date: 2026-11-26. Follows the 2026-11-26 maintenance review. Status: design approved in chat,
spec awaiting review.

## Goal

1. **Signed releases.** The updater installs a release only if it was signed with Briii's key.
   Today it checks the installer against a `.sha256` file from the same GitHub release, which
   only catches a corrupt download. Anyone who can publish a release on the repo (a stolen token,
   for example) can make every Briii Code install a program of their choice when it closes.
2. **Rollback.** After a bad release, the user can go back to the previous one, and the bad one
   isn't reinstalled. Today CI deletes every release but the newest, and the updater never
   installs an older build.

## Decisions (approved)

- **Key:** an Ed25519 key pair. The private key is the secret `BRIII_SIGNING_KEY` in a GitHub
  environment `release` that only the `main` branch may use. The public key ships in
  `briii-update`. Releases stay fully automatic.
- **Not chosen:** Sigstore attestations (no key to manage, but far more verification code in the
  updater) and signing on the user's PC (strongest, but it ends the daily automatic releases).
- **What this protects against:** tampered, swapped or forged release files, and releases
  published by anyone without the key. It doesn't protect against someone who can change the
  workflow on `main`, because the workflow can use the key.
- **Rollback:** CI keeps the newest 3 releases; the command *Briii: Install Previous Version…*
  installs the newest older one and holds back the version it left.

## 1. Signing in CI

- **Signed content:** the exact bytes of the `.sha256` asset, `<sha256>  BriiiCode-Setup-x64-<id>.exe\n`.
  Because it names the release id, an old genuine release can't be republished under a newer
  tag and accepted as an update.
- **Signature asset:** `BriiiCode-Setup-x64-<id>.exe.sha256.sig`, the 64-byte Ed25519 signature
  in base64 (one line).
- **`scripts/sign-release.mjs <sha256-file>`** (Node, no dependencies; PowerShell 5.1 has no
  Ed25519). It reads the PKCS#8 PEM private key from the environment variable
  `BRIII_SIGNING_KEY` and writes `<file>.sig`. It exits non-zero when the variable is missing or
  empty.
- **Self-check before publishing:** `node scripts/sign-release.mjs --verify <sha256-file>` checks
  the signature against the public keys in `brand/extensions/briii-update/lib/releaseKeys.js`.
  A missing key, a failed signature or a key that doesn't match the shipped public key fails the
  run, and nothing is published. An unsigned or wrongly signed release can never reach a user.
- **Workflow** (`release.yml`):
  - the job gets `environment: release`, so `secrets.BRIII_SIGNING_KEY` comes from the
    environment (deployment branches: `main` only);
  - the Publish step writes the `.sha256` (as today), signs it, verifies it, then uploads all three
    assets with `gh release create`.

## 2. Verifying in the updater

- **`lib/releaseKeys.js`** exports a list of public keys (SPKI PEM strings). A list lets a key
  change ship as an ordinary release signed with the old key that adds the new one.
- **`feed.js › toLatest`** also requires the `.sig` asset; a release without it is treated as no
  usable release (`null`), as a release without `.sha256` is today.
- **`feed.js › downloadVerified`** downloads the `.sha256` file and its `.sig` before the
  installer, then checks, in this order:
  1. the signature verifies (`crypto.verify(null, shaBytes, key, sig)`) against at least one key;
  2. the file name in the signed text is exactly `BriiiCode-Setup-x64-<release.id>.exe`;
  3. the installer's SHA-256 equals the signed hash (as today).

  Any failure throws (the error names the check), and the `.part` file is removed, as today.
  A failed check is reported like any failed download: logged in the Updates output and retried
  at the next check. It is never installed.
- **Test mode:** while `BRIII_UPDATE_FEED` is set, the updater also accepts the public key in
  `BRIII_UPDATE_TEST_KEY` (SPKI PEM). Without a test feed that variable is ignored.

## 3. Rollback

### CI keeps 3 releases

The step "Keep only the newest release" keeps the newest 3 (`.[3:]` instead of `.[1:]`). The
newest is marked *Latest*, which is still the only release the automatic updater reads.

### Command

`briii.update.installPrevious`, titled *Install Previous Version…* (category Briii).

1. Fetches `https://api.github.com/repos/<briiiUpdateRepo>/releases?per_page=10` (test hook:
   `BRIII_UPDATE_RELEASES`, read only while `BRIII_UPDATE_FEED` is set, points it at the test
   server's list).
2. Maps each release with `toLatest` (installer, `.sha256` and `.sig` required), and picks the
   newest whose id is older than the running build (`isNewer(current, id)`). New function
   `feed.js › fetchPrevious(listUrl, current)`.
3. None found: an information message, *"No earlier signed release is available."* Nothing
   changes.
4. Otherwise a modal: *"Install Briii Code <prev> instead of <current>? <current> won't be
   installed again; updates resume with the next newer release."* with buttons **Restart and
   Install** and **Install on Close**.
5. Downloads with `downloadVerified` (signature included), then writes `state.json`:
   `pending = { id, path, sha256, rollback: true }`, `failures = 0`, `heldBack = <current>`.
6. **Restart and Install:** starts the helper with relaunch and quits, like *Install Now*.
   **Install on Close:** sets the same flag as *Install Now* (`installRequested`), so the next
   close installs it whatever the update mode.

Download progress shows in a notification. A failed download shows a warning with *Show Update
Log*, and state is unchanged.

### Hold-back and pending rules

- **`check()`:** a release that is not newer than `state.heldBack` counts as no update. When the
  latest release is newer than `heldBack`, it is downloaded as usual and `heldBack` is cleared.
- **Dropping a stale pending installer** (`finishPreviousInstall` and the start of `check()`):
  today a pending installer that isn't newer than the running build is deleted. A pending
  installer with `rollback: true` is kept as long as its id is older than the running build;
  once the rollback has installed (running id equals its id, or the user installed something
  else), it is dropped.
- **`check()` finding a newer release** while a rollback is pending replaces the rollback
  (the newer release clears `heldBack` anyway).
- **`exitInstall.js › shouldInstallOnExit`:** allows a pending installer that is older than the
  running build when it is a rollback (new input `rollback`). All other conditions stay
  (installer exists, failures below the limit, `mayRunInstaller`).
- **`install-on-exit.ps1` and the installer:** unchanged. `setup.iss` doesn't refuse an older
  version, and the staged swap doesn't depend on version order. `Complete-Install` clears
  `pending` on success; `heldBack` stays.

### Edge cases

- **Updates off, or a `-local` build:** the command still works; it is an explicit request.
- **All-users install or a folder the user can't write:** the same message silent updates give
  (`effectiveMode` already detects this); nothing is downloaded.
- **Right after the switch to signing:** the two older releases on GitHub are unsigned, so
  rollback becomes available once two signed releases exist.

## 4. Key handling and rollout

1. Generate the key pair locally (`node scripts/sign-release.mjs --generate <dir>`, a
   subcommand of the same script). It writes `private.pem` and `public.pem` and prints
   the public key.
2. The public key goes into `lib/releaseKeys.js` (committed).
3. The user creates the environment `release` (Settings → Environments; deployment branches:
   `main`) and adds `private.pem`'s contents as the secret `BRIII_SIGNING_KEY`. The user keeps
   a backup of `private.pem` (a password manager), then the local copy is deleted.
4. Push. The first signed release is installed by the current updater, which doesn't check
   signatures; every later release is checked.

**Failure modes:** signing broken in CI means the run fails and no release is published; users
stay on their version until it is fixed. Never published: a release the new updater would
reject. A lost private key: a new key reaches users only through one manual install of a
release signed with it.

## 5. Testing

- **Unit (`briii-update/test`, node:test):**
  - `downloadVerified`: good signature; bad signature; missing `.sig`; signed text naming another
    release id; signature by an unknown key; test key accepted only with a test feed.
  - `toLatest`: release without `.sig` is `null`.
  - `fetchPrevious`: picks the newest older signed release; skips releases missing assets;
    none older gives `null`.
  - `check()`: release not newer than `heldBack` is `none`; a newer one is downloaded and clears
    `heldBack`; a rollback pending installer survives the stale-pending cleanup, and is dropped
    once installed.
  - `shouldInstallOnExit`: rollback older than current installs; a non-rollback older one doesn't.
- **`scripts/sign-release.mjs`:** a node:test file in `scripts/test/` (generate, sign, verify,
  tampered file, missing key).
- **Smoke (`scripts/smoke/index.js`):** the fake feed signs with a key pair generated at run time
  (`BRIII_UPDATE_TEST_KEY`); new checks: a badly signed feed is rejected; *Install Previous
  Version* prepares an older signed release from the fake list (stops before the installer, as
  the update smoke tests do).
- **CI:** the new tests join the "Test built-in extensions" step; the self-check runs in Publish.
