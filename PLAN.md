# Open Participation: build plan

Take-home task for Pixaera: let an admin share one piece of training through a QR code, so people who scan it can play it without an account, while still using the existing session flow.

## Stack

- **Backend:** Node, TypeScript and Express, with an in-memory store behind small repository interfaces and seeded demo data.
- **Frontend:** Angular with two small pages only. The brief says UI is optional, so the backend comes first and the UI is cut down if time runs short.
- **Tests:** one end-to-end file using Node's built-in test runner against the real app.

## Flow

1. An admin creates a share for one content item in their own organisation. The response contains the share URL and its QR code.
2. A visitor scans the QR code, and the play page posts the token to the public redeem endpoint.
3. Redeem checks the share is active and the content is still enabled for the organisation, creates a session through the existing session service, and returns a short-lived playback grant plus a signed CDN URL.
4. While playing, the client refreshes the signed CDN URL before it expires.
5. When playback ends, the client closes the session using the grant.
6. An admin marks the share inactive, and redeem and refresh fail from then on.

## Design decisions

| Decision | Choice | Why |
|---|---|---|
| Share token | Random 256-bit opaque token, with only its hash stored | Unguessable, and a database leak does not leak working links |
| Token location | In the URL fragment: `/play#<token>` | Browsers never send the fragment to a server, so the token stays out of access logs and referrer headers |
| QR code | Shown once at creation; the admin downloads it then | Only the hash is stored, so it cannot be shown again. If lost, create a new share |
| Guest identity | Anonymous, with a random participant ID per session and no personal data | GDPR data minimisation |
| Reporting meaning | Counts plays, not unique people | An honest limit of anonymity |
| Session attribution | Session carries `share_id`, `org_id` and actor type `share_guest` instead of a user ID | Reuses the existing create and close flow with one small extension |
| API protection | Grant is a short-lived signed token scoped to one share, one content item and one session, with its own audience | The normal platform API rejects it, so it cannot reach anything else |
| CDN protection | Signed URL limited to that content's path, with a TTL of a few minutes | No hotlinking and no access to other content |
| Deactivation | API calls check share status every time; CDN access ends when the signed URL expires | Immediate on the API, bounded to minutes on the CDN |
| Expiry | None by default | The brief says a link works until an admin marks it inactive |
| Content disabled for the organisation later | Share stops working | A share must never exceed the organisation's own entitlement |
| Reactivation | Allowed, and audited | Printed QR codes stay useful |

## Layout

```
backend/
  src/
    stubs/        auth, orgs+content, cdn, sessionService
    shares/       share service, routes, token hashing
    playback/     redeem, refresh, close, grant signing
    audit/        audit log
    rateLimit.ts
    app.ts, server.ts
  test/e2e.test.ts
frontend/         Angular: admin page, play page
README.md
```

## Endpoints

| Who | Endpoint | Purpose |
|---|---|---|
| Admin | `POST /api/admin/shares` | Create a share for one content item; returns the URL and QR code |
| Admin | `GET /api/admin/shares` | List the organisation's shares with play counts |
| Admin | `PATCH /api/admin/shares/:id` | Mark inactive or active again |
| Admin | `GET /api/admin/shares/:id/sessions` | Reporting: the sessions for that share |
| Public | `POST /api/public/shares/redeem` | Token in, session created, grant and signed CDN URL out |
| Public | `POST /api/public/playback/refresh` | New signed CDN URL; rechecks the share is still active |
| Public | `POST /api/public/playback/close` | Close the session |
| CDN stub | `GET /cdn/content/:contentId/*` | Serves only with a valid signature that has not expired |

## Session service stub

The stub keeps the existing shape, `create` and `close`, and accepts one of two actor types:

- `{ type: 'user', userId }` for the existing logged-in flow.
- `{ type: 'share_guest', shareId, participantId }` for shared playback.

Sessions left open are closed automatically after a timeout, so reporting has no orphans.

## Misuse handled

- **Token guessing:** high entropy, rate limiting, and identical 404 responses for unknown and inactive shares.
- **Session flooding:** per-share and per-IP rate limits, so reports and costs cannot be polluted.
- **Closing someone else's session:** the grant is bound to one session ID.
- **Orphaned sessions:** auto-close after a timeout.
- **Cross-organisation abuse by an admin:** they can only share content enabled for their own organisation.
- **Link forwarded beyond the intended audience:** inherent to QR sharing; the answer is deactivation plus per-share usage visibility.

## SOC 2 and GDPR

- **Audit log:** share created, deactivated and reactivated, with who and when.
- **Logging:** log the share ID, never the raw token.
- **IP addresses:** used only in memory for rate limiting, never stored.
- **Secrets:** signing keys come from environment variables.
- **Retention:** the README states how long guest sessions are kept.

## Build order

| Step | Work | Minutes |
|---|---|---|
| 1 | Scaffold the backend, the stubs and the seed data (two organisations, several content items, admins) | 15 |
| 2 | Admin share endpoints, the organisation and entitlement checks, and the audit log | 20 |
| 3 | Redeem, grant signing, the signed CDN URLs and the CDN stub | 25 |
| 4 | Refresh, close, the stale-session auto-close and the rate limits | 15 |
| 5 | End-to-end tests | 15 |
| 6 | Angular admin and play pages | 20 |
| 7 | README and the agent logs | 10 |

## What the tests prove

- **Requirement 1:** a grant or signed URL for one training is rejected for other content, for another organisation, and by the admin API.
- **Requirement 2:** redeem creates a session through the session service, close ends it, and the session carries the share and the organisation.
- **Requirement 3:** after deactivation, redeem and refresh fail, and reactivation restores them.
- **Misuse:** a tampered CDN URL, an expired URL, closing another session, an admin sharing content their organisation does not have, and the rate limit.

## Risk

Angular's setup and install will take a real share of the two hours. If step 5 finishes late, ship a single play page and show the admin side with curl commands in the README.

## Submission checklist

- Runnable solution as a repo link or archive.
- Short README: how to run it, the assumptions, and how we know it works.
- Raw logs from every agent used.
- A note on the setup.
- Secrets removed.
