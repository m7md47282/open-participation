import { Router } from 'express';
import type { AuditLog } from '../audit/auditLog.js';
import type { ShareService } from '../shares/shareService.js';
import { findUser, principalOf, requireAdmin } from '../stubs/auth.js';
import type { OrgDirectory } from '../stubs/orgDirectory.js';
import type { ShareRepository } from '../shares/shareRepository.js';
import type { Session, SessionService } from '../stubs/sessionService.js';

/**
 * Admin API. Every route requires a platform admin, and every query is scoped
 * to the admin's own organisation.
 */
export function adminRouter(deps: {
  shareService: ShareService;
  shares: ShareRepository;
  orgs: OrgDirectory;
  sessions: SessionService;
  audit: AuditLog;
}): Router {
  const router = Router();
  router.use('/api/admin', requireAdmin);

  router.get('/api/admin/me', (_req, res) => {
    const principal = principalOf(res);
    res.json({ ...principal, orgName: deps.orgs.getOrg(principal.orgId)?.name });
  });

  router.get('/api/admin/content', (_req, res) => {
    res.json({ content: deps.orgs.listForOrg(principalOf(res).orgId) });
  });

  router.post('/api/admin/shares', async (req, res) => {
    const created = await deps.shareService.create(principalOf(res), req.body ?? {});
    res.status(201).json(created);
  });

  router.get('/api/admin/shares', (_req, res) => {
    res.json({ shares: deps.shareService.list(principalOf(res)) });
  });

  router.patch('/api/admin/shares/:id', (req, res) => {
    res.json({ share: deps.shareService.setStatus(principalOf(res), req.params.id, req.body?.status) });
  });

  router.get('/api/admin/shares/:id/sessions', (req, res) => {
    res.json({ sessions: deps.shareService.sessions(principalOf(res), req.params.id).map((s) => reportRow(s, deps)) });
  });

  /** The organisation's playback report: platform users and share guests side by side. */
  router.get('/api/admin/reports/sessions', (_req, res) => {
    const sessions = deps.sessions.list({ orgId: principalOf(res).orgId });
    res.json({ sessions: sessions.map((s) => reportRow(s, deps)) });
  });

  router.get('/api/admin/audit', (_req, res) => {
    res.json({ events: deps.audit.listByOrg(principalOf(res).orgId) });
  });

  return router;
}

/** How a session appears in reporting. Share guests are anonymous and attributed to the share. */
function reportRow(session: Session, deps: { shares: ShareRepository; orgs: OrgDirectory }) {
  const base = {
    sessionId: session.id,
    orgId: session.orgId,
    contentId: session.contentId,
    contentTitle: deps.orgs.getContent(session.contentId)?.title ?? session.contentId,
    status: session.status,
    startedAt: session.startedAt,
    endedAt: session.endedAt ?? null,
    closeReason: session.closeReason ?? null,
  };
  if (session.actor.type === 'user') {
    return {
      ...base,
      source: 'platform' as const,
      participant: findUser(session.actor.userId)?.displayName ?? session.actor.userId,
      shareId: null,
    };
  }
  const share = deps.shares.get(session.actor.shareId);
  return {
    ...base,
    source: 'share' as const,
    participant: `Anonymous participant (${session.actor.participantId})`,
    shareId: session.actor.shareId,
    shareLabel: share?.label ?? null,
  };
}
