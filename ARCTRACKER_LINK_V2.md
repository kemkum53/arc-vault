# arctracker.io Link v2 Migration

arctracker.io retired the old integration on 2026-10-01. Both ends of our
integration broke:

- Token push `POST /api/desktop/embark-token` -> `503 EMBARK_SYNC_DISABLED`.
- Data pull `POST /api/embark/sync/*`, `GET /api/embark/status` -> `410 EMBARK_SYNC_RETIRED` / `401`.

The replacement is a device-pairing flow (the "ARC Tracker Link" desktop app).
We replicate that flow on the API side only. The harvester and the web app do
not change: the harvester still reads the Embark JWT from Windows Credential
Manager and POSTs it to `/api/accounts/token-push`.

## Push flow (replaces `/api/desktop/embark-token`)

Verified end to end against a live account on 2026-10-02 (Xbox/WinGDK token
accepted; no embedded app secret required; no subscription required for the
link-triggered sync).

1. Web sign-in: `POST /api/auth/sign-in/email {email,password}` -> session cookie.
2. Create pairing code: `POST /api/me/embark/link-requests {provider}` with
   `X-ArcTracker-Client: web/3.0.0` -> `data.deepLink` containing `?code=...`.
3. Exchange code for a device token: `POST /api/auth/bridge/link-token
   {code, deviceId, appVersion:"2.0.3", platform:"windows"}` with
   `X-ArcTracker-Client: ARCTrackerLink/2.0.3` -> `data.token` (device JWT).
4. Push the Embark JWT: `POST /api/me/embark/token
   {accessToken:<embark jwt>, provider, reason:"link"}` with
   `Authorization: Bearer <device token>` and
   `X-ArcTracker-Client: arctracker-link/2.0.3` -> `200`.

Notes:
- The client header value differs per endpoint: step 3 accepts
  `ARCTrackerLink/2.0.3`; step 4 requires the lowercase `arctracker-link/2.0.3`
  (any other value returns `426 CLIENT_TOO_OLD "malformed"`).
- `provider` enum is `steam|epic`. Xbox/WinGDK tokens are accepted with
  `provider:"steam"`; arctracker derives the real account from the token.
- `deviceId` is derived deterministically per account (uuid5) so we reuse one
  device row instead of registering a new one on every push.
- Step 4 with `reason:"link"` makes arctracker's server fetch the full
  inventory from Embark (it holds the manifest-id server side). We never touch
  the Embark game API or its manifest-id.

## Pull flow (replaces `/api/embark/sync/*`)

Session-based reads with the same web cookie:

- `GET /api/me/stash` -> `data.categories[0]`:
  - `items: [[slug, qty], ...]`
  - `details: {indexAsString: {a:[mod_slug|null,...], d:durabilityPercent}}`
    keyed by the position in `items`.
  - `value`, `capacity`, `stacks`.
- `GET /api/me/progress` -> `data.records[]`, each `{kind, key, value, source}`:
  - `kind="blueprint"`  value `true`                     -> learned blueprint
  - `kind="quest"`      value `{state:"completed"|...}`  -> completed quest
  - `kind="hideout"`    value `<int level>`              -> hideout module level
  - `kind="project_phase"` value `true`                 -> project phase done
  - `kind="category_goal"` / `needed_count`             -> project sub-goals
  - `kind="player"`     value `{level, xpCurrent}`       -> character level/xp
  - `source` is `embark` (synced) or `import` (manual/guest).

The API-key variant (`/api/v2/user/stash` etc., `X-App-Key` header) exists but
we use the session variant because we already hold each account's
email/password.

## Risk / maintenance

- Replicating the desktop-app client identity violates arctracker's ToS. The
  account owner accepted this risk explicitly for their own accounts.
- Brittle: arctracker can change the client-header format or pairing flow on any
  Link release; expect to re-verify after their updates.

## Status

- [x] Push flow proven live (token set, server-side sync ran, stash populated).
- [x] Pull format mapped (stash + progress).
- [x] Push rework in `arctracker_bridge.link_embark_token` + `accounts._submit_token_for_account` (verified live).
- [x] Pull rework in `arctracker_client.fetch_all` (adapts stash+progress to `sync_service`; verified live: 296 items, 83 blueprints, 18 quests, 9 hideout, player).
- [x] `sync_service` guards: domains no longer wipe rows when data is absent; economy fields no longer overwritten with None; `player` level/xp applied.
- [ ] Projects mapping (flat `project_phase`/`category_goal`/`needed_count` -> `CharacterProject`); currently left untouched (not wiped).
- [ ] Deploy (ask first) and verify across all accounts; watch the first Xbox account sync.
- [ ] Clean up harvester noise (dead-token retry backoff, readable API errors) — independent.
