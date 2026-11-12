import type { Clock } from '../lib/clock.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import type { FixedWindowLimiter } from '../lib/rateLimit.js';
import type { ShareRepository } from '../shares/shareRepository.js';
import type { CdnSigner } from '../stubs/cdn.js';
import type { OrgDirectory } from '../stubs/orgDirectory.js';
import type { CloseReason, SessionService } from '../stubs/sessionService.js';
import type { GrantClaims, GrantSigner } from './grant.js';

const MAX_TOKEN_LENGTH = 128;

// One answer for unknown, inactive and no-longer-entitled shares, so callers cannot probe which is which.
const shareNotFound = () => new AppError(404, 'share_not_found', 'This link is not valid or is no longer active');

/**
 * Tells a viewer who already holds a valid grant why their session ended.
 * Safe to be specific here: the grant proves they redeemed this share.
 */
function endedError(reason: CloseReason | undefined): AppError {
  switch (reason) {
    case 'share_deactivated':
      return new AppError(410, 'share_inactive', 'This link has been deactivated');
    case 'content_disabled':
      return new AppError(410, 'content_unavailable', 'This training is no longer available');
    case 'idle_timeout':
      return new AppError(410, 'session_closed', 'This session timed out. Scan the QR code again to restart.');
    default:
      return new AppError(410, 'session_closed', 'This playback session has ended');
  }
}

export class PlaybackService {
  constructor(
    private readonly deps: {
      shares: ShareRepository;
      orgs: OrgDirectory;
      sessions: SessionService;
      grants: GrantSigner;
      cdn: CdnSigner;
      ipLimiter: FixedWindowLimiter;
      shareLimiter: FixedWindowLimiter;
      clock: Clock;
      sessionIdleTimeoutSeconds: number;
      cdnUrlTtlSeconds: number;
    },
  ) {}

  /** Visitor scanned the QR code: validate the share, open a session, hand out a scoped grant. */
  redeem(token: unknown, clientIp: string) {
    const { shares, orgs, sessions, grants, cdn, ipLimiter, shareLimiter } = this.deps;

    const ipCheck = ipLimiter.take(`ip:${clientIp}`);
    if (!ipCheck.allowed) throw new AppError(429, 'rate_limited', 'Too many attempts, try again shortly', ipCheck.retryAfterSeconds);

    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) throw shareNotFound();
    const share = shares.findByTokenHash(sha256Hex(token));
    if (!share || share.status !== 'active') throw shareNotFound();
    if (!orgs.isShareable(share.orgId, share.contentId)) throw shareNotFound();

    // Caps how many sessions one share can create, so a leaked link cannot flood reporting or cost.
    const shareCheck = shareLimiter.take(`share:${share.id}`);
    if (!shareCheck.allowed) throw new AppError(429, 'rate_limited', 'This link is busy, try again shortly', shareCheck.retryAfterSeconds);

    const session = sessions.create({
      orgId: share.orgId,
      contentId: share.contentId,
      actor: { type: 'share_guest', shareId: share.id, participantId: `anon_${randomToken(12)}` },
    });
    const { grant, expiresAt } = grants.sign({ sid: session.id, shr: share.id, cid: share.contentId, org: share.orgId });
    const content = orgs.getContent(share.contentId)!;

    return {
      sessionId: session.id,
      grant,
      grantExpiresAt: expiresAt,
      content: { id: content.id, title: content.title, durationSeconds: content.durationSeconds },
      playback: cdn.signedUrl(content.id),
      refreshAfterSeconds: this.refreshAfterSeconds(),
    };
  }

  /**
   * Called before the signed CDN URL expires. Re-checks the share every time,
   * so deactivation reaches running playback within one CDN URL lifetime.
   * Doubles as the heartbeat that keeps the session open.
   */
  refresh(claims: GrantClaims) {
    const session = this.openSessionFor(claims);
    const share = this.deps.shares.get(claims.shr);
    if (!share || share.status !== 'active') {
      this.deps.sessions.close(session.id, 'share_deactivated');
      throw new AppError(410, 'share_inactive', 'This link has been deactivated');
    }
    if (!this.deps.orgs.isShareable(claims.org, claims.cid)) {
      this.deps.sessions.close(session.id, 'content_disabled');
      throw new AppError(410, 'content_unavailable', 'This training is no longer available');
    }
    this.deps.sessions.heartbeat(session.id);
    return { playback: this.deps.cdn.signedUrl(claims.cid), refreshAfterSeconds: this.refreshAfterSeconds() };
  }

  /** Closes the session named in the grant. A grant cannot name any other session. */
  close(claims: GrantClaims, reason: unknown) {
    const closeReason: CloseReason = reason === 'abandoned' ? 'abandoned' : 'completed';
    const session = this.deps.sessions.get(claims.sid);
    if (!session || session.actor.type !== 'share_guest' || session.actor.shareId !== claims.shr) {
      throw new AppError(404, 'session_not_found', 'Session not found');
    }
    const closed = this.deps.sessions.close(session.id, closeReason)!;
    return { sessionId: closed.id, status: closed.status, closeReason: closed.closeReason };
  }

  /** Closes guest sessions whose viewer vanished without calling close (tab closed, phone locked). */
  sweepIdleSessions(): number {
    const cutoff = this.deps.clock() - this.deps.sessionIdleTimeoutSeconds * 1000;
    let closed = 0;
    for (const session of this.deps.sessions.list({ status: 'open' })) {
      if (session.actor.type === 'share_guest' && Date.parse(session.lastSeenAt) < cutoff) {
        this.deps.sessions.close(session.id, 'idle_timeout');
        closed += 1;
      }
    }
    this.deps.ipLimiter.prune();
    this.deps.shareLimiter.prune();
    return closed;
  }

  private openSessionFor(claims: GrantClaims) {
    const session = this.deps.sessions.get(claims.sid);
    if (!session || session.actor.type !== 'share_guest' || session.actor.shareId !== claims.shr) {
      throw new AppError(404, 'session_not_found', 'Session not found');
    }
    if (session.status !== 'open') throw endedError(session.closeReason);
    return session;
  }

  private refreshAfterSeconds(): number {
    // Refresh at 80% of the URL lifetime so playback never hits an expired URL.
    return Math.max(1, Math.floor(this.deps.cdnUrlTtlSeconds * 0.8));
  }
}
