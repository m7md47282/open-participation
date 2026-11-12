import type { NextFunction, Request, Response } from 'express';
import type { Clock } from '../lib/clock.js';
import { signPayload, verifyPayload } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';

/**
 * A playback grant is what an anonymous viewer holds after redeeming a share.
 * It is scoped to exactly one session, one share, one content item and one organisation,
 * and its audience is "share-playback". It is signed with its own key, so the platform's
 * normal authentication never accepts it.
 */

export const GRANT_AUDIENCE = 'share-playback';

export interface GrantClaims {
  aud: typeof GRANT_AUDIENCE;
  sid: string;
  shr: string;
  cid: string;
  org: string;
  exp: number;
}

export class GrantSigner {
  constructor(
    private readonly key: string,
    private readonly ttlSeconds: number,
    private readonly clock: Clock,
  ) {}

  sign(claims: Omit<GrantClaims, 'aud' | 'exp'>): { grant: string; expiresAt: string } {
    const exp = Math.floor(this.clock() / 1000) + this.ttlSeconds;
    const grant = signPayload({ aud: GRANT_AUDIENCE, ...claims, exp } satisfies GrantClaims, this.key);
    return { grant, expiresAt: new Date(exp * 1000).toISOString() };
  }

  verify(token: string): GrantClaims | null {
    const claims = verifyPayload<GrantClaims>(token, this.key);
    if (!claims || claims.aud !== GRANT_AUDIENCE) return null;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= this.clock()) return null;
    if (![claims.sid, claims.shr, claims.cid, claims.org].every((v) => typeof v === 'string')) return null;
    return claims;
  }

  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const match = /^Bearer (.+)$/.exec(req.get('authorization') ?? '');
      const claims = match ? this.verify(match[1]!) : null;
      if (!claims) throw new AppError(401, 'invalid_grant', 'Playback grant is missing, invalid or expired');
      res.locals.grant = claims;
      next();
    };
  }
}

export function grantOf(res: Response): GrantClaims {
  return res.locals.grant as GrantClaims;
}
