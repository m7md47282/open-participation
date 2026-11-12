# Open Participation

Backend that lets an admin share one training through a QR code, so people who scan it can play it without an account, while playback still goes through the existing session flow. Auth, organisations, the CDN and the session service are stubbed. A small Angular UI is included for the demo.

**Live demo:** https://open-participation-707253960131.us-central1.run.app/admin (Google Cloud Run, scales to zero, so the first request may take a few seconds and demo data resets when idle).

Design and diagrams: [ARCHITECTURE.md](ARCHITECTURE.md). QA test cases and expected results: [TEST_CASES.md](TEST_CASES.md) (also shown in the app at `/test-cases`). Original plan: [PLAN.md](PLAN.md).

## How to run

Requires Node 22+ (built on Node 24). Docker is optional.

| Goal | Command | Then open |
|---|---|---|
| Run in Docker | `npm run deploy` | http://localhost:3000/admin |
| Run in Docker, scannable from a phone on the same Wi-Fi | `npm run deploy:lan` | the admin URL it prints |
| Stop Docker | `npm run stop` | |
| Deploy to Google Cloud Run (lowest cost) | `GCP_PROJECT=<project-id> scripts/deploy-gcp.sh` | the admin URL it prints |
| Run without Docker | `npm start` | http://localhost:3000/admin |
| Development with live reload | `npm run dev` | http://localhost:4200/admin |
| Backend tests | `npm test` | |
| Browser and UX tests (Playwright) | `npm run test:ui` | report: `cd ui-tests && npx playwright show-report` |

`deploy-gcp.sh` builds the image on your machine, pushes it to Artifact Registry, keeps the signing keys in Secret Manager, and deploys to Cloud Run scaled to zero with one instance at most, so a demo stays inside the free tier. Because data is in memory, it resets whenever the service scales to zero. On Cloud Run use `/health`, because paths ending in `z` are reserved there.

`deploy` creates `.env` from `.env.example` on first run and generates both signing keys. The first Docker build takes about two minutes. Data is in memory and resets on restart.

### Demo walk-through

1. Open `/admin`. You are signed in as Alice, an admin at Acme (the login is stubbed; switch users in the top right).
2. Pick a training, add a label, and click **Create share**. Download the QR code or click **Open as a visitor**.
3. The play page opens in a fresh state with no login. Click **Finish training** (or let it run).
4. Back on `/admin`: the share shows a play count, and the session report lists an **Anonymous participant** attributed to the share, next to normal platform users.
5. Click **Mark inactive**. The audit log records it, and the same link now shows "not valid or is no longer active". **Reactivate** brings it back.

### API with curl

```bash
B=http://localhost:3000; A='Authorization: Bearer demo-admin-acme'

# Admin creates a share (the token is in the URL fragment after #)
curl -s -X POST $B/api/admin/shares -H "$A" -H 'content-type: application/json' \
  -d '{"contentId":"c_fire_safety","label":"Gate poster"}'

# Visitor redeems the token: gets a session, a playback grant and a signed CDN URL
curl -s -X POST $B/api/public/shares/redeem -H 'content-type: application/json' -d '{"token":"<token>"}'

# Refresh (re-checks the share) and close, using the grant
curl -s -X POST $B/api/public/playback/refresh -H 'Authorization: Bearer <grant>'
curl -s -X POST $B/api/public/playback/close   -H 'Authorization: Bearer <grant>' \
  -H 'content-type: application/json' -d '{"reason":"completed"}'

# Admin: list, deactivate, report, audit
curl -s $B/api/admin/shares -H "$A"
curl -s -X PATCH $B/api/admin/shares/<shareId> -H "$A" -H 'content-type: application/json' -d '{"status":"inactive"}'
curl -s $B/api/admin/reports/sessions -H "$A"
curl -s $B/api/admin/audit -H "$A"
```

Demo logins: `demo-admin-acme`, `demo-admin-globex`, `demo-learner-acme` (not an admin).

## Assumptions and decisions

**Who is the person behind a shared session?** Nobody we identify. Each scan creates a session whose actor is `share_guest` with the share ID and a random participant ID, and no name, email, IP or device data. In reporting they appear as "Anonymous participant (anon_…)" with the share's label, next to platform users. Counts therefore mean plays, not unique people. If a customer needs named attendance, that is a different feature (an optional name field with consent and a retention policy), not a default.

**How are the CDN and API protected?**
- The share token (256 random bits) only works on the redeem endpoint, and is stored as a SHA-256 hash.
- Redeem returns a **playback grant**: an HMAC-signed token with its own key and audience, bound to one session, share, content item and organisation. The admin API and platform auth reject it.
- Media is served through **signed CDN URLs** that cover one content item's folder and expire after 5 minutes. Editing the path to other content breaks the signature.
- The token is carried in the URL fragment (`/play#token`), which browsers never send to servers, so it stays out of access logs and Referer headers. The play page removes it from the address bar on load.

**"A link works until an admin marks it inactive."** Shares have no expiry. Deactivation blocks new scans immediately, closes running sessions, and the next refresh fails. Media already in flight keeps working until its signed URL expires (at most 5 minutes). That bound is the deliberate trade-off of using a CDN. Shares can be reactivated, so printed QR codes stay useful; every change is audited.

**What can be shared?** Only content enabled for the admin's **whole organisation**. Content limited to specific groups cannot be shared, because that would bypass a deliberate restriction. If the content is later removed from the organisation, the share stops working.

**Misuse handled:** token guessing (entropy, per-IP limit, identical 404 for unknown and inactive links); session flooding through a leaked link (per-share limit, play counts, deactivation); tampering with grants or CDN URLs (HMAC, constant-time compare); closing someone else's session (the grant names exactly one session); orphaned sessions (heartbeat via refresh, idle sweep); cross-organisation access by admins (every admin query is scoped to their organisation, others' shares return 404). Forwarding a link to people outside the intended audience is inherent to QR sharing; the answer is visibility and deactivation.

**SOC 2 and GDPR:** audit trail for share changes; no tokens, query strings or bodies in logs; no personal data stored for guests; IPs held in memory for one minute for rate limiting only; signing keys from the environment, required in production; security headers and strict CSP; container runs as non-root on a read-only filesystem. A production retention period for guest sessions is listed in ARCHITECTURE.md.

**Stubs:** auth is a static map of demo bearer tokens; organisations, content and entitlements are seeded in memory; the session service keeps its create and close shape with one extension (the `share_guest` actor); the CDN is an Express route that verifies the same signed URLs a real CDN would.

## How we know it works

- **31 end-to-end tests** ([backend/test/e2e.test.ts](backend/test/e2e.test.ts)) run against the real HTTP app with a controllable clock, grouped by requirement:
  - Requirement 1: the signed URL plays the shared content only; other content, tampered signatures, missing signatures and expired URLs are rejected; the grant is rejected by every admin route; an edited grant is rejected.
  - Requirement 2: redeem creates a session through the session service with the share and organisation on it; close works and is idempotent; a grant only closes its own session; the report shows anonymous participants with no personal fields; idle sessions are closed.
  - Requirement 3: a link still works after 90 days; deactivation blocks redeem, ends running sessions, fails refresh and is audited; reactivation restores the same link; removing content from the organisation disables its shares.
  - Misuse: identical responses for unknown and inactive links, per-IP and per-share rate limits, malformed input, security headers.
- **52 browser tests** ([ui-tests/tests](ui-tests/tests)) with Playwright on desktop Chrome and a Pixel 7 profile. They start their own server on port 3100.
  - Admin: only shareable training is offered, the QR code and link are shown once, deactivate and reactivate are audited, another organisation sees nothing, a learner is refused.
  - Visitor: the full journey from the admin's QR code to an anonymous play in the report, with the token removed from the address bar; unknown, missing and inactive links; deactivation during playback ends it at the next refresh; leaving the page closes the session as abandoned.
  - UX: axe accessibility scans (WCAG 2.1 A and AA) in light and dark mode on every page state, keyboard-only share creation with visible focus, no sideways scrolling on a phone, 44 px touch targets, the main action visible without scrolling, an announced loading state, and no console errors.
  - The first run found real issues, which were fixed: unlabelled form fields, errors and loading not announced to screen readers, scrollable tables unreachable by keyboard, low contrast on the inactive badge, opening a second link in the same tab doing nothing, a vague message when a share was deactivated mid-play, and the deactivate button hidden off-screen on phones.
- **Docker check:** the same flow was driven in a browser against the Docker container, with no console errors.
- **Manual curl run** of the same flow, plus a check that the share token never appears in server logs.

## Project layout

```
backend/
  src/
    stubs/       auth, orgDirectory, sessionService, cdn   (the existing platform, stubbed)
    shares/      share repository and service
    playback/    grant signing, redeem, refresh, close, idle sweep
    routes/      admin and public HTTP routes
    audit/       audit log
    lib/         crypto, errors, rate limiter, clock
    app.ts, server.ts, config.ts, seed.ts
  test/e2e.test.ts
frontend/        Angular 22: admin page and play page
ui-tests/        Playwright browser, accessibility and UX tests
scripts/         setup, dev, run, test, deploy, stop
Dockerfile, docker-compose.yml, .env.example
```

## Setup note

Built with Claude Code (VS Code extension) on macOS, using Claude as the coding agent: we discussed the brief and design first, wrote [PLAN.md](PLAN.md), then built, tested and verified in the browser. Stack: Node 24, TypeScript, Express 5, Angular 22, Node's built-in test runner, Playwright with axe-core, Docker. The raw agent logs are in `agent-logs/`.
