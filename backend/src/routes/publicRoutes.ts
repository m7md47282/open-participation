import { Router } from 'express';
import { grantOf, type GrantSigner } from '../playback/grant.js';
import type { PlaybackService } from '../playback/playbackService.js';
import { optionalPrincipal } from '../stubs/auth.js';

/**
 * Public API for anonymous viewers. No platform login.
 * Redeem takes the share token; refresh and close take only the playback grant.
 * None of these routes can reach admin data, other content or other organisations.
 */
export function publicRouter(deps: { playback: PlaybackService; grants: GrantSigner }): Router {
  const router = Router();
  const requireGrant = deps.grants.middleware();

  // A platform login is optional here. With one, the play is recorded under that user's name.
  router.post('/api/public/shares/redeem', (req, res) => {
    res.status(201).json(deps.playback.redeem(req.body?.token, req.ip ?? 'unknown', optionalPrincipal(req)));
  });

  router.post('/api/public/playback/refresh', requireGrant, (_req, res) => {
    res.json(deps.playback.refresh(grantOf(res)));
  });

  router.post('/api/public/playback/close', requireGrant, (req, res) => {
    res.json(deps.playback.close(grantOf(res), req.body?.reason));
  });

  return router;
}
