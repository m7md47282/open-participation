# Architecture

How Open Participation lets an anonymous visitor play one shared training without widening access to anything else.

## 1. The idea in one paragraph

An admin creates a **share** for one training. The share has a random secret token that goes into a QR code. When a visitor scans it, the backend swaps the token for two short-lived, narrowly scoped credentials: a **playback grant** (for our API) and a **signed CDN URL** (for the media). Neither credential is a platform login, and each names exactly one training, one share, one organisation and one session. Playback runs through the existing session service, with the share recorded as the actor. Deactivating the share stops new scans immediately and ends running playback within one CDN URL lifetime.

## 2. System context

```mermaid
flowchart LR
  Admin["Org admin<br/>(platform login)"]
  Visitor["Visitor<br/>(no account)"]

  subgraph Backend["Open Participation backend (Node, Express)"]
    AdminAPI["Admin API<br/>/api/admin/*"]
    PublicAPI["Public API<br/>/api/public/*"]
    ShareSvc["ShareService"]
    PlaySvc["PlaybackService"]
    Grants["GrantSigner"]
    Limiter["Rate limiters"]
    Audit["Audit log"]
    Shares[("Share store<br/>token hashes only")]
  end

  subgraph Existing["Existing platform (stubbed here)"]
    Auth["Auth"]
    Orgs["Orgs, content,<br/>entitlements"]
    Sessions["Session service"]
    CDN["CDN<br/>(signed URLs)"]
  end

  Admin -->|bearer login| AdminAPI
  AdminAPI --> Auth
  AdminAPI --> ShareSvc
  ShareSvc --> Orgs
  ShareSvc --> Shares
  ShareSvc --> Audit
  ShareSvc --> Sessions

  Visitor -->|share token| PublicAPI
  Visitor -->|signed URL| CDN
  PublicAPI --> Limiter
  PublicAPI --> PlaySvc
  PlaySvc --> Shares
  PlaySvc --> Orgs
  PlaySvc --> Sessions
  PlaySvc --> Grants
  PlaySvc -->|signs URL| CDN
```

The Angular app (admin page and play page) is a thin client over these APIs. It is served by the same Express process in this demo.

## 3. Components

| Component | File | Responsibility |
|---|---|---|
| Admin routes | [backend/src/routes/adminRoutes.ts](backend/src/routes/adminRoutes.ts) | Admin-only endpoints, always scoped to the admin's own organisation; builds report rows |
| Public routes | [backend/src/routes/publicRoutes.ts](backend/src/routes/publicRoutes.ts) | Redeem, refresh and close for anonymous visitors |
| ShareService | [backend/src/shares/shareService.ts](backend/src/shares/shareService.ts) | Create, list, activate and deactivate shares; entitlement checks; QR generation; audit |
| ShareRepository | [backend/src/shares/shareRepository.ts](backend/src/shares/shareRepository.ts) | Stores shares with the token's SHA-256 hash, never the token |
| PlaybackService | [backend/src/playback/playbackService.ts](backend/src/playback/playbackService.ts) | Redeem, refresh (heartbeat and re-check), close, idle sweep |
| GrantSigner | [backend/src/playback/grant.ts](backend/src/playback/grant.ts) | Signs and verifies playback grants (HMAC-SHA256, own key, audience `share-playback`) |
| AuditLog | [backend/src/audit/auditLog.ts](backend/src/audit/auditLog.ts) | Append-only record of share changes |
| Rate limiter | [backend/src/lib/rateLimit.ts](backend/src/lib/rateLimit.ts) | Per-IP and per-share limits on redeem |
| Auth stub | [backend/src/stubs/auth.ts](backend/src/stubs/auth.ts) | Demo admin and learner logins |
| Org directory stub | [backend/src/stubs/orgDirectory.ts](backend/src/stubs/orgDirectory.ts) | Organisations, content, org-wide and group entitlements |
| Session service stub | [backend/src/stubs/sessionService.ts](backend/src/stubs/sessionService.ts) | Existing create and close flow, extended with a `share_guest` actor |
| CDN stub | [backend/src/stubs/cdn.ts](backend/src/stubs/cdn.ts) | Signs URLs for one content folder with an expiry; rejects anything else |

Every component takes its dependencies through its constructor, including a clock, so tests can move time forward and the in-memory stores can be swapped for real ones.

## 4. Data model

```mermaid
erDiagram
  ORG ||--o{ ENTITLEMENT : has
  CONTENT ||--o{ ENTITLEMENT : "enabled by"
  ORG ||--o{ SHARE : owns
  CONTENT ||--o{ SHARE : "shared as"
  SHARE ||--o{ SESSION : "attributed to"
  ORG ||--o{ SESSION : "reported under"
  SHARE ||--o{ AUDIT_EVENT : "changes recorded in"

  SHARE {
    string id
    string orgId
    string contentId
    string label
    string tokenHash "SHA-256, token itself never stored"
    string status "active or inactive"
    string createdBy
    datetime createdAt
    string statusChangedBy
    datetime statusChangedAt
  }
  SESSION {
    string id
    string orgId
    string contentId
    json actor "user: userId; or share_guest: shareId, participantId"
    string status "open or closed"
    datetime startedAt
    datetime lastSeenAt
    datetime endedAt
    string closeReason
  }
  ENTITLEMENT {
    string orgId
    string contentId
    json scope "org or groups"
  }
```

The only change to the existing session model is the actor union: a session's actor is either a user or a share guest.

## 5. Credentials and what each can reach

| Credential | Who holds it | Lifetime | Can reach | Cannot reach |
|---|---|---|---|---|
| Platform login | Admins, learners | Existing | Admin API (admins only) | Nothing new |
| Share token | Anyone with the QR code | Until the share is deactivated | Only the redeem endpoint | Any other endpoint |
| Playback grant | One visitor, one session | 4 hours (config) | Refresh and close for its own session | Admin API, other sessions, other content |
| Signed CDN URL | One visitor | 5 minutes (config) | Files under one content folder | Any other content |

The grant and the CDN URL are signed with two different keys, and neither key is used by the platform login. A forged or edited grant fails its HMAC check.

## 6. Request flows

### Create a share

```mermaid
sequenceDiagram
  actor A as Admin
  participant API as Admin API
  participant SS as ShareService
  participant O as Org directory
  participant DB as Share store
  participant AL as Audit log

  A->>API: POST /api/admin/shares {contentId, label}
  API->>API: check platform login and admin role
  API->>SS: create(principal, input)
  SS->>O: is content enabled org-wide for this org?
  alt not enabled, or only for groups
    SS-->>A: 404 or 422
  end
  SS->>SS: token = 256 random bits
  SS->>DB: insert share with sha256(token)
  SS->>AL: share.created
  SS-->>A: share, shareUrl (/play#token), QR code
  Note over A: Shown once. Only the hash is kept.
```

### Scan, play, close

```mermaid
sequenceDiagram
  actor V as Visitor
  participant P as Play page
  participant API as Public API
  participant PS as PlaybackService
  participant SV as Session service
  participant CDN as CDN

  V->>P: scan QR, open /play#token
  P->>P: read token from fragment, remove it from address bar
  P->>API: POST /api/public/shares/redeem {token}
  API->>PS: redeem(token, ip)
  PS->>PS: per-IP limit, look up sha256(token)
  PS->>PS: share active? content still enabled org-wide?
  PS->>PS: per-share limit
  PS->>SV: create session (actor share_guest, shareId, random participantId)
  PS-->>P: grant, signed CDN URL, refreshAfterSeconds
  P->>CDN: GET /cdn/content/id/manifest.json?exp&sig
  CDN-->>P: media
  loop every 80% of the URL lifetime
    P->>API: POST /api/public/playback/refresh (grant)
    API->>PS: share still active? content still enabled?
    PS->>SV: heartbeat
    PS-->>P: new signed CDN URL
  end
  P->>API: POST /api/public/playback/close (grant)
  PS->>SV: close session (completed)
```

### Deactivate

```mermaid
sequenceDiagram
  actor A as Admin
  participant SS as ShareService
  participant SV as Session service
  participant AL as Audit log
  actor V as Visitor

  A->>SS: PATCH /api/admin/shares/id {status: inactive}
  SS->>SV: close open sessions for this share (share_deactivated)
  SS->>AL: share.deactivated
  V->>SS: redeem with the old token
  SS-->>V: 404, same response as an unknown token
  Note over V: A visitor already playing keeps the current CDN URL<br/>until it expires (at most 5 minutes), and the next refresh fails with 410.
```

## 7. How deactivation propagates

| Path | When it stops working |
|---|---|
| New scans (redeem) | Immediately |
| Refresh and close for running playback | Immediately (session already closed) |
| CDN access for running playback | When the current signed URL expires, at most `CDN_URL_TTL_SECONDS` (5 minutes) |

The 5-minute bound is a deliberate trade-off. A CDN cannot ask our database on every request without losing the point of a CDN. A shorter TTL means more refresh calls; a real deployment could also push a revocation to the CDN for faster cut-off.

## 8. Reporting

Share guests appear in the organisation's session report next to platform users:

| Participant | Source | Training |
|---|---|---|
| Bob Learner | Platform login | Fire Safety Basics |
| Anonymous participant (anon_x7Kq…) | Share: Site gate poster | Fire Safety Basics |

Each scan gets a new random participant ID, so counts mean **plays, not unique people**. That is the honest consequence of not identifying anyone.

## 9. Security and compliance controls

| Concern | Control |
|---|---|
| Access stays narrow (requirement 1) | Grant and CDN URL scoped to one content item; grants rejected by the admin API; group-only content cannot be shared; admins only see their own organisation's shares |
| Token leakage | 256-bit token, stored as SHA-256 hash, carried in the URL fragment, removed from the address bar, never logged; `Referrer-Policy: no-referrer` |
| Guessing | Per-IP rate limit; unknown, inactive and no-longer-entitled links return the identical 404 |
| Flooding a leaked link | Per-share rate limit; admin sees play counts and can deactivate |
| Orphaned sessions | Refresh doubles as a heartbeat; idle guest sessions are closed by a sweeper |
| Tampering | HMAC-SHA256 with constant-time comparison on grants and CDN URLs |
| SOC 2 audit trail | Every create, deactivate and reactivate is recorded with actor and time |
| GDPR minimisation | No name, email, IP or device data stored for guests; IPs exist only in rate-limit memory for one minute |
| Secrets | Signing keys from environment variables; the app refuses to start in production without them |
| Transport and browser | Helmet security headers, strict CSP, `Cache-Control: no-store` on the API, 10 kB body limit |
| Container | Non-root user, read-only filesystem, `no-new-privileges` |

## 10. Deployment

```mermaid
flowchart LR
  Browser --> Container
  subgraph Container["Docker container (node:24-alpine, non-root)"]
    Express["Express :3000"]
    Static["Angular build"]
    Mem[("In-memory stores")]
    Express --> Static
    Express --> Mem
  end
```

One image built in three stages: Angular build, backend build, slim runtime. `scripts/deploy.sh` generates signing keys into `.env` on first run and starts it with docker compose.

## 11. What changes for production

| Demo | Production |
|---|---|
| In-memory stores | Postgres tables for shares and audit events; the real session service |
| In-memory rate limits | Redis, or limits at the WAF or edge, so they hold across instances |
| CDN stub with HMAC URLs | CloudFront signed URLs or Cloudflare token auth, using the same prefix-and-expiry model |
| Demo bearer tokens | The platform's real authentication and roles |
| Audit to memory and stdout | Immutable audit store or SIEM |
| Idle sweep in process | Scheduled job |
| Guest session retention | A retention job, for example 13 months, aligned with the organisation's reporting policy |
