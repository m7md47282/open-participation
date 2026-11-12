import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import type { AuditLog } from '../audit/auditLog.js';
import type { Clock } from '../lib/clock.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import type { Principal } from '../stubs/auth.js';
import type { OrgDirectory } from '../stubs/orgDirectory.js';
import type { SessionService } from '../stubs/sessionService.js';
import type { Share, ShareRepository } from './shareRepository.js';

/** What admins see. The token hash is never returned. */
export type ShareView = Omit<Share, 'tokenHash'> & {
  contentTitle: string;
  stats: { totalSessions: number; openSessions: number };
};

export interface CreatedShare {
  share: ShareView;
  /** Shown once. Only the hash is stored, so this cannot be retrieved again. */
  shareUrl: string;
  qrCodeDataUrl: string;
}

export class ShareService {
  constructor(
    private readonly deps: {
      shares: ShareRepository;
      orgs: OrgDirectory;
      sessions: SessionService;
      audit: AuditLog;
      clock: Clock;
      publicBaseUrl: string;
    },
  ) {}

  async create(principal: Principal, input: { contentId: unknown; label?: unknown }): Promise<CreatedShare> {
    const { orgs, shares, audit, clock, publicBaseUrl } = this.deps;
    if (typeof input.contentId !== 'string' || input.contentId.length === 0) {
      throw new AppError(400, 'bad_request', 'contentId is required');
    }
    const label = typeof input.label === 'string' ? input.label.trim().slice(0, 100) : '';

    const entitlement = orgs.entitlementFor(principal.orgId, input.contentId);
    if (!entitlement || !orgs.getContent(input.contentId)) {
      // Same answer whether the content does not exist or belongs to another organisation.
      throw new AppError(404, 'content_not_found', 'This content is not enabled for your organisation');
    }
    if (!orgs.isShareable(principal.orgId, input.contentId)) {
      throw new AppError(422, 'content_not_shareable', 'Only content enabled for the whole organisation can be shared');
    }

    const token = randomToken();
    const share: Share = {
      id: `shr_${randomUUID()}`,
      orgId: principal.orgId,
      contentId: input.contentId,
      label: label || orgs.getContent(input.contentId)!.title,
      tokenHash: sha256Hex(token),
      status: 'active',
      createdBy: principal.userId,
      createdAt: new Date(clock()).toISOString(),
    };
    shares.insert(share);
    audit.record({
      orgId: share.orgId,
      actor: { type: 'user', userId: principal.userId },
      action: 'share.created',
      targetId: share.id,
      details: { contentId: share.contentId },
    });

    // The token goes in the URL fragment: browsers never send it to a server,
    // so it stays out of access logs, proxies and Referer headers.
    const shareUrl = `${publicBaseUrl}/play#${token}`;
    const qrCodeDataUrl = await QRCode.toDataURL(shareUrl, { errorCorrectionLevel: 'M', margin: 2, width: 320 });
    return { share: this.view(share), shareUrl, qrCodeDataUrl };
  }

  list(principal: Principal): ShareView[] {
    return this.deps.shares
      .listByOrg(principal.orgId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((s) => this.view(s));
  }

  setStatus(principal: Principal, shareId: string, status: unknown): ShareView {
    if (status !== 'active' && status !== 'inactive') {
      throw new AppError(400, 'bad_request', 'status must be "active" or "inactive"');
    }
    const share = this.ownedShare(principal, shareId);
    if (share.status === status) return this.view(share);

    const updated = this.deps.shares.update(share.id, {
      status,
      statusChangedAt: new Date(this.deps.clock()).toISOString(),
      statusChangedBy: principal.userId,
    })!;

    let closedSessions = 0;
    if (status === 'inactive') {
      // End playback that is already running, so the share stops working everywhere,
      // not only for new visitors.
      for (const session of this.deps.sessions.list({ shareId: share.id, status: 'open' })) {
        this.deps.sessions.close(session.id, 'share_deactivated');
        closedSessions += 1;
      }
    }

    this.deps.audit.record({
      orgId: share.orgId,
      actor: { type: 'user', userId: principal.userId },
      action: status === 'inactive' ? 'share.deactivated' : 'share.reactivated',
      targetId: share.id,
      ...(status === 'inactive' ? { details: { closedSessions } } : {}),
    });
    return this.view(updated);
  }

  sessions(principal: Principal, shareId: string) {
    const share = this.ownedShare(principal, shareId);
    return this.deps.sessions.list({ shareId: share.id });
  }

  /** Admins can only see their own organisation's shares. Others look like they do not exist. */
  private ownedShare(principal: Principal, shareId: string): Share {
    const share = this.deps.shares.get(shareId);
    if (!share || share.orgId !== principal.orgId) throw new AppError(404, 'share_not_found', 'Share not found');
    return share;
  }

  private view(share: Share): ShareView {
    const { tokenHash: _omit, ...rest } = share;
    const sessions = this.deps.sessions.list({ shareId: share.id });
    return {
      ...rest,
      contentTitle: this.deps.orgs.getContent(share.contentId)?.title ?? share.contentId,
      stats: {
        totalSessions: sessions.length,
        openSessions: sessions.filter((s) => s.status === 'open').length,
      },
    };
  }
}
