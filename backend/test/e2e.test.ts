import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

/**
 * End-to-end tests against the real HTTP app. Each describe block maps to a requirement
 * in the brief. Time is controlled through an injected clock.
 */

const ADMIN_ACME = { authorization: 'Bearer demo-admin-acme' };
const ADMIN_GLOBEX = { authorization: 'Bearer demo-admin-globex' };
const LEARNER_ACME = { authorization: 'Bearer demo-learner-acme' };

function harness(overrides: Record<string, string> = {}) {
  let now = Date.parse('2026-11-12T10:00:00Z');
  const clock = () => now;
  const config = loadConfig({
    NODE_ENV: 'test',
    GRANT_SIGNING_KEY: 'g'.repeat(64),
    CDN_SIGNING_KEY: 'c'.repeat(64),
    REDEEM_LIMIT_PER_IP_PER_MINUTE: '1000',
    REDEEM_LIMIT_PER_SHARE_PER_MINUTE: '1000',
    ...overrides,
  });
  const { app, ctx } = createApp(config, clock);
  const server = app.listen(0);
  const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call(method: string, path: string, opts: { headers?: Record<string, string>; body?: unknown } = {}) {
    const res = await fetch(base() + path, {
      method,
      headers: { 'content-type': 'application/json', ...opts.headers },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, body: json, headers: res.headers };
  }

  /** Signed CDN URLs are absolute; tests call them on the test server by path. */
  const cdnGet = (url: string) => call('GET', new URL(url).pathname + new URL(url).search);

  async function createShare(contentId = 'c_fire_safety', headers = ADMIN_ACME) {
    const res = await call('POST', '/api/admin/shares', { headers, body: { contentId, label: 'Site gate poster' } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const token = new URL(res.body.shareUrl).hash.slice(1);
    return { share: res.body.share, token, body: res.body };
  }

  const redeem = (token: string) => call('POST', '/api/public/shares/redeem', { body: { token } });
  const asGrant = (grant: string) => ({ authorization: `Bearer ${grant}` });

  return {
    ctx,
    call,
    cdnGet,
    createShare,
    redeem,
    asGrant,
    advance: (seconds: number) => {
      now += seconds * 1000;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('admin creates a share', () => {
  const h = harness();
  after(h.close);

  test('returns a share URL with the token in the fragment, a QR code, and never the token hash', async () => {
    const { share, token, body } = await h.createShare();
    assert.match(body.shareUrl, /\/play#[A-Za-z0-9_-]{43}$/);
    assert.match(body.qrCodeDataUrl, /^data:image\/png;base64,/);
    assert.equal(share.status, 'active');
    assert.equal(share.orgId, 'org_acme');
    assert.equal('tokenHash' in share, false);
    assert.ok(token.length >= 43);

    const list = await h.call('GET', '/api/admin/shares', { headers: ADMIN_ACME });
    assert.equal(JSON.stringify(list.body).includes(token), false, 'token must not be retrievable later');
  });

  test('records an audit event', async () => {
    const audit = await h.call('GET', '/api/admin/audit', { headers: ADMIN_ACME });
    assert.ok(audit.body.events.some((e: any) => e.action === 'share.created' && e.actor.userId === 'u_alice'));
  });

  test('requires a platform admin', async () => {
    assert.equal((await h.call('POST', '/api/admin/shares', { body: { contentId: 'c_fire_safety' } })).status, 401);
    const learner = await h.call('POST', '/api/admin/shares', { headers: LEARNER_ACME, body: { contentId: 'c_fire_safety' } });
    assert.equal(learner.status, 403);
  });

  test('cannot share content that is not enabled for the admin organisation', async () => {
    const res = await h.call('POST', '/api/admin/shares', { headers: ADMIN_ACME, body: { contentId: 'c_ladder' } });
    assert.equal(res.status, 404);
  });

  test('cannot share content that is only enabled for specific groups', async () => {
    const res = await h.call('POST', '/api/admin/shares', { headers: ADMIN_ACME, body: { contentId: 'c_confined_space' } });
    assert.equal(res.status, 422);
  });

  test('admins cannot see or change another organisation share', async () => {
    const { share } = await h.createShare();
    const patch = await h.call('PATCH', `/api/admin/shares/${share.id}`, { headers: ADMIN_GLOBEX, body: { status: 'inactive' } });
    assert.equal(patch.status, 404);
    const sessions = await h.call('GET', `/api/admin/shares/${share.id}/sessions`, { headers: ADMIN_GLOBEX });
    assert.equal(sessions.status, 404);
    const list = await h.call('GET', '/api/admin/shares', { headers: ADMIN_GLOBEX });
    assert.equal(list.body.shares.length, 0);
  });
});

describe('requirement 1: only the shared training is playable', () => {
  const h = harness();
  after(h.close);
  let grant: string;
  let playbackUrl: string;

  before(async () => {
    const { token } = await h.createShare('c_fire_safety');
    const res = await h.redeem(token);
    assert.equal(res.status, 201);
    grant = res.body.grant;
    playbackUrl = res.body.playback.url;
  });

  test('the signed CDN URL plays the shared content, including other files in its folder', async () => {
    const manifest = await h.cdnGet(playbackUrl);
    assert.equal(manifest.status, 200);
    assert.equal(manifest.body.contentId, 'c_fire_safety');
    const segment = await h.cdnGet(playbackUrl.replace('manifest.json', 'segment-1.bin'));
    assert.equal(segment.status, 200);
  });

  test('editing the URL to point at other content is rejected by the CDN', async () => {
    for (const other of ['c_forklift', 'c_ladder', 'c_confined_space']) {
      const res = await h.cdnGet(playbackUrl.replace('c_fire_safety', other));
      assert.equal(res.status, 403, `CDN served ${other}`);
    }
  });

  test('path traversal out of the content folder is rejected', async () => {
    const url = new URL(playbackUrl);
    const res = await h.call('GET', `/cdn/content/c_fire_safety/..%2F..%2Fcontent%2Fc_forklift%2Fmanifest.json${url.search}`);
    assert.notEqual(res.body?.contentId, 'c_forklift');
  });

  test('a tampered signature is rejected', async () => {
    const res = await h.cdnGet(playbackUrl.replace(/sig=[^&]+/, 'sig=AAAA'));
    assert.equal(res.status, 403);
  });

  test('CDN content without a signature is rejected', async () => {
    assert.equal((await h.call('GET', '/cdn/content/c_fire_safety/manifest.json')).status, 403);
  });

  test('the signed URL expires after its TTL', async () => {
    h.advance(301);
    const res = await h.cdnGet(playbackUrl);
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'url_expired');
  });

  test('the playback grant does not work on the admin API or any platform route', async () => {
    for (const path of ['/api/admin/shares', '/api/admin/content', '/api/admin/reports/sessions', '/api/admin/me']) {
      const res = await h.call('GET', path, { headers: h.asGrant(grant) });
      assert.equal(res.status, 401, `${path} accepted a playback grant`);
    }
  });

  test('a grant with an edited payload is rejected', async () => {
    const [body, sig] = grant.split('.');
    const claims = JSON.parse(Buffer.from(body!, 'base64url').toString());
    claims.cid = 'c_forklift';
    const forged = `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${sig}`;
    const res = await h.call('POST', '/api/public/playback/refresh', { headers: h.asGrant(forged) });
    assert.equal(res.status, 401);
  });
});

describe('requirement 2: shared playback uses the session flow and is attributable', () => {
  const h = harness();
  after(h.close);

  test('redeem creates a session through the session service, attributed to the share and organisation', async () => {
    const { share, token } = await h.createShare();
    const res = await h.redeem(token);
    assert.equal(res.status, 201);

    const session = h.ctx.sessions.get(res.body.sessionId)!;
    assert.equal(session.status, 'open');
    assert.equal(session.orgId, 'org_acme');
    assert.equal(session.contentId, 'c_fire_safety');
    assert.equal(session.actor.type, 'share_guest');
    assert.equal(session.actor.type === 'share_guest' && session.actor.shareId, share.id);
  });

  test('close ends the session and is idempotent', async () => {
    const { token } = await h.createShare();
    const { body } = await h.redeem(token);
    const first = await h.call('POST', '/api/public/playback/close', { headers: h.asGrant(body.grant), body: { reason: 'completed' } });
    assert.equal(first.status, 200);
    assert.equal(first.body.status, 'closed');
    assert.equal(h.ctx.sessions.get(body.sessionId)!.closeReason, 'completed');
    const second = await h.call('POST', '/api/public/playback/close', { headers: h.asGrant(body.grant) });
    assert.equal(second.status, 200);
  });

  test('each grant can only close its own session', async () => {
    const { token } = await h.createShare();
    const a = await h.redeem(token);
    const b = await h.redeem(token);
    await h.call('POST', '/api/public/playback/close', { headers: h.asGrant(a.body.grant) });
    assert.equal(h.ctx.sessions.get(a.body.sessionId)!.status, 'closed');
    assert.equal(h.ctx.sessions.get(b.body.sessionId)!.status, 'open');
  });

  test('every scan is a separate anonymous participant', async () => {
    const { token } = await h.createShare();
    const a = h.ctx.sessions.get((await h.redeem(token)).body.sessionId)!;
    const b = h.ctx.sessions.get((await h.redeem(token)).body.sessionId)!;
    assert.ok(a.actor.type === 'share_guest' && b.actor.type === 'share_guest');
    assert.notEqual(a.actor.participantId, b.actor.participantId);
  });

  test('the report shows guests as anonymous participants attributed to the share, next to platform users', async () => {
    const { share, token } = await h.createShare();
    await h.redeem(token);
    const report = await h.call('GET', '/api/admin/reports/sessions', { headers: ADMIN_ACME });
    const guestRow = report.body.sessions.find((r: any) => r.shareId === share.id);
    assert.equal(guestRow.source, 'share');
    assert.match(guestRow.participant, /^Anonymous participant/);
    assert.equal(guestRow.shareLabel, 'Site gate poster');
    assert.ok(report.body.sessions.some((r: any) => r.source === 'platform' && r.participant === 'Bob Learner'));
    for (const field of ['ip', 'ipAddress', 'userAgent', 'email', 'name', 'userId']) {
      assert.equal(field in guestRow, false, `report row must not contain ${field}`);
    }
  });

  test('share list shows usage counts', async () => {
    const { share, token } = await h.createShare();
    await h.redeem(token);
    await h.redeem(token);
    const list = await h.call('GET', '/api/admin/shares', { headers: ADMIN_ACME });
    const row = list.body.shares.find((s: any) => s.id === share.id);
    assert.deepEqual(row.stats, { totalSessions: 2, openSessions: 2 });
  });

  test('guest sessions that stop sending heartbeats are closed automatically', async () => {
    const { token } = await h.createShare();
    const { body } = await h.redeem(token);
    h.advance(16 * 60);
    h.ctx.playback.sweepIdleSessions();
    assert.equal(h.ctx.sessions.get(body.sessionId)!.closeReason, 'idle_timeout');
  });
});

describe('requirement 3: a link works until an admin marks it inactive', () => {
  const h = harness();
  after(h.close);

  test('a link keeps working over time with no expiry', async () => {
    const { token } = await h.createShare();
    h.advance(90 * 24 * 60 * 60);
    assert.equal((await h.redeem(token)).status, 201);
  });

  test('deactivation blocks new scans, ends running playback, and is audited', async () => {
    const { share, token } = await h.createShare();
    const running = await h.redeem(token);

    const off = await h.call('PATCH', `/api/admin/shares/${share.id}`, { headers: ADMIN_ACME, body: { status: 'inactive' } });
    assert.equal(off.status, 200);
    assert.equal(off.body.share.status, 'inactive');

    assert.equal((await h.redeem(token)).status, 404);
    assert.equal(h.ctx.sessions.get(running.body.sessionId)!.closeReason, 'share_deactivated');
    const refresh = await h.call('POST', '/api/public/playback/refresh', { headers: h.asGrant(running.body.grant) });
    assert.equal(refresh.status, 410);
    assert.equal(refresh.body.error, 'share_inactive', 'viewer is told the link was deactivated');

    const audit = await h.call('GET', '/api/admin/audit', { headers: ADMIN_ACME });
    assert.ok(audit.body.events.some((e: any) => e.action === 'share.deactivated' && e.targetId === share.id));
  });

  test('reactivation makes the same link (and printed QR code) work again', async () => {
    const { share, token } = await h.createShare();
    await h.call('PATCH', `/api/admin/shares/${share.id}`, { headers: ADMIN_ACME, body: { status: 'inactive' } });
    assert.equal((await h.redeem(token)).status, 404);
    await h.call('PATCH', `/api/admin/shares/${share.id}`, { headers: ADMIN_ACME, body: { status: 'active' } });
    assert.equal((await h.redeem(token)).status, 201);
  });

  test('refresh keeps an active session alive and returns a fresh signed URL', async () => {
    const { token } = await h.createShare();
    const { body } = await h.redeem(token);
    h.advance(240);
    const refresh = await h.call('POST', '/api/public/playback/refresh', { headers: h.asGrant(body.grant) });
    assert.equal(refresh.status, 200);
    assert.equal((await h.cdnGet(refresh.body.playback.url)).status, 200);
  });

  test('if the content is removed from the organisation, the share stops working', async () => {
    const { token } = await h.createShare('c_forklift');
    const running = await h.redeem(token);
    h.ctx.orgs.disable('org_acme', 'c_forklift');
    assert.equal((await h.redeem(token)).status, 404);
    const refresh = await h.call('POST', '/api/public/playback/refresh', { headers: h.asGrant(running.body.grant) });
    assert.equal(refresh.status, 410);
    assert.equal(h.ctx.sessions.get(running.body.sessionId)!.closeReason, 'content_disabled');
  });
});

describe('misuse', () => {
  test('unknown and inactive links get the identical response', async () => {
    const h = harness();
    const { share, token } = await h.createShare();
    await h.call('PATCH', `/api/admin/shares/${share.id}`, { headers: ADMIN_ACME, body: { status: 'inactive' } });
    const inactive = await h.redeem(token);
    const unknown = await h.redeem('x'.repeat(43));
    assert.equal(inactive.status, unknown.status);
    assert.deepEqual(inactive.body, unknown.body);
    await h.close();
  });

  test('token guessing is rate limited per client', async () => {
    const h = harness({ REDEEM_LIMIT_PER_IP_PER_MINUTE: '5' });
    for (let i = 0; i < 5; i++) assert.equal((await h.redeem(`guess-${i}`)).status, 404);
    const blocked = await h.redeem('guess-6');
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('retry-after'));
    h.advance(61);
    assert.equal((await h.redeem('guess-7')).status, 404);
    await h.close();
  });

  test('session flooding through one link is capped per share', async () => {
    const h = harness({ REDEEM_LIMIT_PER_SHARE_PER_MINUTE: '3' });
    const { token } = await h.createShare();
    for (let i = 0; i < 3; i++) assert.equal((await h.redeem(token)).status, 201);
    assert.equal((await h.redeem(token)).status, 429);
    await h.close();
  });

  test('oversized and malformed input is rejected cleanly', async () => {
    const h = harness();
    assert.equal((await h.redeem('a'.repeat(5000))).status, 404);
    assert.equal((await h.call('POST', '/api/public/shares/redeem', { body: { token: 123 } })).status, 404);
    await h.close();
  });

  test('responses carry security headers and are not cached', async () => {
    const h = harness();
    const { token } = await h.createShare();
    const res = await h.redeem(token);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('x-powered-by'), null);
    await h.close();
  });
});
