import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../lib/errors.js';

/**
 * STUB of the existing platform authentication.
 * The real platform would verify a session cookie or an OIDC token issued for platform users.
 * Here, static demo bearer tokens map to users. Playback grants are a different kind of token
 * (different key, different audience), so they can never authenticate here.
 */

export interface Principal {
  userId: string;
  orgId: string;
  role: 'admin' | 'learner';
  displayName: string;
}

const DEMO_TOKENS: Record<string, Principal> = {
  'demo-admin-acme': { userId: 'u_alice', orgId: 'org_acme', role: 'admin', displayName: 'Alice Admin' },
  'demo-learner-acme': { userId: 'u_bob', orgId: 'org_acme', role: 'learner', displayName: 'Bob Learner' },
  'demo-admin-globex': { userId: 'u_carol', orgId: 'org_globex', role: 'admin', displayName: 'Carol Admin' },
};

const USERS_BY_ID = new Map(Object.values(DEMO_TOKENS).map((p) => [p.userId, p]));

export function findUser(userId: string): Principal | undefined {
  return USERS_BY_ID.get(userId);
}

export function demoTokens(): Array<{ token: string; principal: Principal }> {
  return Object.entries(DEMO_TOKENS).map(([token, principal]) => ({ token, principal }));
}

function authenticate(req: Request): Principal | undefined {
  const header = req.get('authorization') ?? '';
  const match = /^Bearer (.+)$/.exec(header);
  return match ? DEMO_TOKENS[match[1]!] : undefined;
}

export const requireAdmin: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const principal = authenticate(req);
  if (!principal) throw new AppError(401, 'unauthenticated', 'A platform login is required');
  if (principal.role !== 'admin') throw new AppError(403, 'forbidden', 'Only organisation admins can manage shares');
  res.locals.principal = principal;
  next();
};

export function principalOf(res: Response): Principal {
  return res.locals.principal as Principal;
}
