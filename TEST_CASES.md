# Test cases: Open Participation

QA test plan for sharing one training through a QR code. Each case lists the steps, the expected result, and the automated test that covers it, so it can be run by hand or checked against the test reports.

## 1. What the feature must do

An organisation admin can share **one training** through a **QR code**. Anyone who scans it can watch that training **without an account**. Four rules from the brief:

| # | Rule | In plain words, we expect |
|---|---|---|
| R1 | Only the shared training is playable | The QR code opens that one training and nothing else: no other training, no other organisation, no admin pages |
| R2 | Playback uses the existing session flow and is attributable | Every play creates a session and closes it at the end; the report shows which share and organisation it came from |
| R3 | A link works until an admin marks it inactive | No expiry date; once marked inactive it stops working; it can be turned back on |
| R4 | SOC 2 and GDPR apply | Changes are audited; visitors stay anonymous; no personal data is stored; secrets are protected |

**How a visitor appears in reports:** as "Anonymous participant (anon_…)", with the share's label as the source. Every scan counts as a new participant, so numbers mean **plays, not unique people**.

## 2. Test data

| Item | Value |
|---|---|
| Admin at Acme Construction | Login `demo-admin-acme` (Alice) |
| Admin at Globex Energy | Login `demo-admin-globex` (Carol) |
| Learner at Acme, not an admin | Login `demo-learner-acme` (Bob) |
| Acme training, whole organisation (shareable) | Fire Safety Basics, Forklift Hazard Awareness |
| Acme training, supervisors group only (not shareable) | Confined Space Entry |
| Globex training (shareable) | Working at Height: Ladders |
| Signed media link lifetime | 5 minutes, refreshed every 4 minutes |
| Rate limits on opening a link | 20 per minute per visitor, 120 per minute per share |
| Idle session timeout | 15 minutes without a refresh |

On the admin page, switch users with **Signed in as** in the top right.

## 3. How to run

| What | How |
|---|---|
| Automated backend tests | `npm test` (file: `backend/test/e2e.test.ts`) |
| Automated browser and UX tests | `npm run test:ui` (folder: `ui-tests/tests`) |
| Manual testing | `npm run deploy`, then open http://localhost:3000/admin |
| Phone testing | `npm run deploy:lan`, then scan the QR code with a phone on the same Wi-Fi |

In the **Covered by** column, **API** means the backend test file and **UI** means the browser test files. **Manual** means there is no automated test.

## 4. Admin: creating and managing shares

| ID | Scenario | Steps | Expected result | Covered by |
|---|---|---|---|---|
| TC-01 | Admin sees their organisation | 1. Open `/admin` as Alice | Header shows "Alice Admin · Acme Construction" | UI: admin |
| TC-02 | Only whole-organisation training is offered | 1. Open the **Training to share** list | Shows Fire Safety Basics and Forklift Hazard Awareness only. Confined Space Entry is listed under content as "not shareable" | UI: admin |
| TC-03 | Create a share | 1. Pick Fire Safety Basics<br>2. Label "Gate poster"<br>3. Click **Create share** | A QR code, the link (`…/play#<code>`) and a **Download QR** button appear. The share is listed as **active** with 0 plays | API, UI: admin |
| TC-04 | Link is shown only once | 1. Create a share<br>2. Reload the page | The share is still listed, but the link and QR code are no longer shown anywhere | API, UI: admin |
| TC-05 | Creation is audited | 1. Create a share<br>2. Look at **Audit log** | A `share.created` entry with the share ID and `u_alice` | API, UI: admin |
| TC-06 | Download the QR code | 1. Create a share<br>2. Click **Download QR** | A file `share-qr.png` downloads, and scanning it opens the play page | UI (attribute check), Manual (scan) |
| TC-07 | Label is optional | 1. Create a share with an empty label | The share is labelled with the training title | Manual |
| TC-08 | Learner cannot manage shares | 1. Switch to Bob (learner) | Red message "Only organisation admins can manage shares"; no share form | API, UI: admin |
| TC-09 | Not logged in | 1. Call `POST /api/admin/shares` with no login | 401 unauthenticated | API |
| TC-10 | Cannot share another organisation's training | 1. As Alice, call create with `c_ladder` (Globex training) | 404 "This content is not enabled for your organisation" | API |
| TC-11 | Cannot share group-only training | 1. As Alice, call create with `c_confined_space` | 422 "Only content enabled for the whole organisation can be shared" | API |
| TC-12 | Admins only see their own organisation's shares | 1. Alice creates a share<br>2. Switch to Carol (Globex) | Carol's list does not show Alice's share. Changing or viewing it by ID returns 404 | API, UI: admin |

## 5. R1: only the shared training is playable

| ID | Scenario | Steps | Expected result | Covered by |
|---|---|---|---|---|
| TC-13 | Visitor plays without an account | 1. Open the share link in a private window | The training title appears with "Playing", a **Finish training** button, and the note that no account is needed | API, UI: visitor |
| TC-14 | Media for the shared training loads | 1. Open a share link | The signed media link returns the training's media (200) | API |
| TC-15 | Editing the media link to other training fails | 1. Take the signed media link<br>2. Replace `c_fire_safety` with `c_forklift` | 403 invalid_signature; other training never loads | API |
| TC-16 | Path tricks do not escape the training folder | 1. Request `../../content/c_forklift/manifest.json` with a valid signature | The other training's media is not returned | API |
| TC-17 | Tampered signature fails | 1. Change the `sig=` value in the media link | 403 | API |
| TC-18 | Media without a signature fails | 1. Request `/cdn/content/c_fire_safety/manifest.json` with no `exp` and `sig` | 403 | API |
| TC-19 | Media link expires | 1. Wait more than 5 minutes after getting a media link<br>2. Use the old link | 403 url_expired | API |
| TC-20 | Visitor's pass cannot open admin pages | 1. Use the visitor's playback grant on `/api/admin/shares`, `/content`, `/reports/sessions`, `/me` | 401 on every one | API |
| TC-21 | Forged visitor pass fails | 1. Change the training inside the playback grant without re-signing | 401 invalid_grant | API |

## 6. R2: sessions and reporting

| ID | Scenario | Steps | Expected result | Covered by |
|---|---|---|---|---|
| TC-22 | Opening a link creates a session | 1. Open a share link | An open session exists with the organisation, the training, actor type `share_guest` and the share ID | API, UI: visitor |
| TC-23 | Finishing closes the session | 1. Click **Finish training** | "Training complete". The session is closed with reason `completed` | API, UI: visitor |
| TC-24 | Closing twice is safe | 1. Close the same session twice | Both return 200; the session stays closed | API |
| TC-25 | A visitor can only close their own session | 1. Two visitors open the same link<br>2. Visitor A finishes | A's session is closed; B's is still open | API |
| TC-26 | Each scan is a new anonymous participant | 1. Open the same link twice | Two sessions with different `anon_…` participant IDs | API |
| TC-27 | Report shows the visitor anonymously | 1. Play a share<br>2. Look at **Session report** | A row "Anonymous participant (anon_…)" with source "Share: <label>", next to platform users such as Bob Learner | API, UI: visitor |
| TC-28 | Report has no personal data | 1. Inspect a visitor's report row | No IP, user agent, email, name or user ID fields | API |
| TC-29 | Share list shows usage | 1. Open a link twice | **Plays** shows 2 and **Playing now** shows 2; after finishing, **Playing now** goes down | API, UI: visitor |
| TC-30 | Leaving the page closes the session | 1. Open a link<br>2. Close the tab | The session is closed with reason `abandoned` | UI: visitor |
| TC-31 | Abandoned sessions time out | 1. Open a link<br>2. Send no refresh for 15 minutes | The session is closed with reason `idle_timeout` | API |

## 7. R3: a link works until marked inactive

| ID | Scenario | Steps | Expected result | Covered by |
|---|---|---|---|---|
| TC-32 | No expiry date | 1. Create a share<br>2. Open it 90 days later | It still works | API |
| TC-33 | Mark inactive blocks new visitors | 1. Click **Mark inactive**<br>2. Open the link | "Unavailable: This link is not valid or is no longer active." The share shows **inactive** | API, UI: visitor and admin |
| TC-34 | Mark inactive is audited | 1. Mark a share inactive | A `share.deactivated` audit entry with the admin's ID | API, UI: admin |
| TC-35 | Mark inactive stops someone already watching | 1. Visitor is watching<br>2. Admin marks the share inactive | The session closes at once (`share_deactivated`). At the visitor's next refresh (within 4 minutes) the page shows "This link has been deactivated" | API, UI: visitor |
| TC-36 | Reactivate restores the same link | 1. Mark inactive<br>2. Click **Reactivate**<br>3. Open the same link | It works again; the printed QR code does not need replacing. A `share.reactivated` audit entry exists | API, UI: admin and visitor |
| TC-37 | Refresh keeps playback going | 1. Watch for more than 4 minutes | The page gets a new media link before the old one expires; playback continues | API |
| TC-38 | Training removed from the organisation | 1. Remove the training from Acme<br>2. Open the link, or refresh while watching | New opens show "not valid"; running playback ends with "This training is no longer available" | API |

## 8. Misuse and security

| ID | Scenario | Steps | Expected result | Covered by |
|---|---|---|---|---|
| TC-39 | Unknown and inactive links look the same | 1. Open a made-up link<br>2. Open an inactive link | Identical 404 response, so nobody can tell which links exist | API |
| TC-40 | Guessing links is rate limited | 1. Try more than 20 links in one minute from one device | 429 "Too many attempts" with a Retry-After header; works again after a minute | API |
| TC-41 | One link cannot flood sessions | 1. Open the same link more than 120 times in one minute | Further opens get 429 "This link is busy" | API |
| TC-42 | Bad input is rejected cleanly | 1. Send a 5,000-character code, a number instead of text, or broken JSON | 404 or 400 with a clear message; no crash | API |
| TC-43 | Code stays out of the address bar | 1. Open a share link | Once the page loads, the address bar shows `/play` without the code | UI: visitor |
| TC-44 | Code never appears in server logs | 1. Open a link<br>2. Search the server logs for the code | Not found; logs contain only method, path and status | Manual (verified during build) |
| TC-45 | Security headers are set | 1. Check any API response | `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, a strict Content-Security-Policy, and no `X-Powered-By` | API |
| TC-46 | Production refuses to start without keys | 1. Start with `NODE_ENV=production` and no signing keys | The app exits with an error naming the missing key | Manual |

## 9. Privacy and compliance (SOC 2, GDPR)

| ID | Scenario | Steps | Expected result | Covered by |
|---|---|---|---|---|
| TC-47 | No personal data from visitors | 1. Play a share<br>2. Inspect the session and the report | Only a random participant ID; no name, email, IP or device stored | API |
| TC-48 | Every share change is traceable | 1. Create, deactivate and reactivate a share | Three audit entries, each with time, admin and share ID | API, UI: admin |
| TC-49 | Only the code's hash is stored | 1. List shares through the API | No `tokenHash` or code in any response | API |
| TC-50 | Secrets are not in the code | 1. Look at the repository | Keys only in `.env`, which is ignored by Git and Docker; `.env.example` has empty keys | Manual |

## 10. UI, UX and accessibility

| ID | Scenario | Steps | Expected result | Covered by |
|---|---|---|---|---|
| TC-51 | Accessible in light and dark mode | 1. Run an accessibility scan on the admin page, and on the play page while playing, finished and unavailable | No WCAG 2.1 A or AA violations | UI: ux |
| TC-52 | Theme follows the device | 1. Switch the device to dark mode | Dark background and readable text; light mode is light | UI: ux |
| TC-53 | Keyboard only | 1. Tab through the form<br>2. Press Enter on **Create share** | Every control is reachable with a visible focus outline; the share is created | UI: ux |
| TC-54 | Comfortable on a phone | 1. Open the play page on a phone | No sideways scrolling; buttons at least 44px tall; **Finish training** visible without scrolling; title readable | UI: ux |
| TC-55 | Admin page works on a phone | 1. Open `/admin` on a phone | Each share is a card with labelled fields and a full-width **Mark inactive** button | UI: ux |
| TC-56 | Loading is announced | 1. Open a link on a slow connection | "Opening training…" is shown and announced to screen readers | UI: ux |
| TC-57 | Clear error states | 1. Open `/play` with no code, an unknown code, or an inactive code | A plain message says what happened, such as "missing its code" or "not valid or is no longer active" | UI: visitor |
| TC-58 | No console errors | 1. Use the admin and play pages | The browser console shows no errors | UI: ux |
| TC-59 | Opening a second link in the same tab | 1. While on a play page, open another share link in the same tab | The page reloads and plays the new training | Manual |

## 11. Deployment

| ID | Scenario | Steps | Expected result | Covered by |
|---|---|---|---|---|
| TC-60 | One-command deploy | 1. Run `npm run deploy` | The image builds; "Running." is printed with the admin URL; `/healthz` returns `{"status":"ok"}` | Manual (verified) |
| TC-61 | Keys generated on first deploy | 1. Delete `.env`<br>2. Run `npm run deploy` | A new `.env` is created with two random 64-character keys | Manual (verified) |
| TC-62 | Container is locked down | 1. Run `docker compose exec app whoami` | `node` (not root); the filesystem is read-only | Manual (verified) |
| TC-63 | Phone demo over Wi-Fi | 1. Run `npm run deploy:lan`<br>2. Scan the QR code with a phone | The play page opens on the phone and plays | Manual |

## 12. Known limits (expected, not bugs)

- After deactivation, a visitor already watching keeps the current media link for up to **5 minutes**. That is the trade-off of serving media from a CDN; the admin side and new scans stop at once.
- Data is held in memory, so it resets when the app restarts.
- Logins are stubbed with demo users; the real platform login would replace them.
- The player is simulated at 10x speed; there is no real video.
