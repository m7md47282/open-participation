import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { AuditLog } from './audit/auditLog.js';
import type { Config } from './config.js';
import { type Clock, systemClock } from './lib/clock.js';
import { AppError, errorHandler } from './lib/errors.js';
import { FixedWindowLimiter } from './lib/rateLimit.js';
import { GrantSigner } from './playback/grant.js';
import { PlaybackService } from './playback/playbackService.js';
import { adminRouter } from './routes/adminRoutes.js';
import { publicRouter } from './routes/publicRoutes.js';
import { seedOrgDirectory, seedSessions } from './seed.js';
import { ShareRepository } from './shares/shareRepository.js';
import { ShareService } from './shares/shareService.js';
import { CdnSigner, cdnRouter } from './stubs/cdn.js';
import { SessionService } from './stubs/sessionService.js';

export function createApp(config: Config, clock: Clock = systemClock) {
  const orgs = seedOrgDirectory();
  const sessions = new SessionService(clock);
  seedSessions(sessions);
  const shares = new ShareRepository();
  const audit = new AuditLog(clock);
  const grants = new GrantSigner(config.grantSigningKey, config.grantTtlSeconds, clock);
  const cdn = new CdnSigner(config.cdnSigningKey, config.cdnUrlTtlSeconds, clock, config.publicBaseUrl);
  const shareService = new ShareService({ shares, orgs, sessions, audit, clock, publicBaseUrl: config.publicBaseUrl });
  const playback = new PlaybackService({
    shares,
    orgs,
    sessions,
    grants,
    cdn,
    clock,
    ipLimiter: new FixedWindowLimiter(config.redeemLimitPerIpPerMinute, 60_000, clock),
    shareLimiter: new FixedWindowLimiter(config.redeemLimitPerSharePerMinute, 60_000, clock),
    sessionIdleTimeoutSeconds: config.sessionIdleTimeoutSeconds,
    cdnUrlTtlSeconds: config.cdnUrlTtlSeconds,
  });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  // Helmet's defaults include a strict CSP and Referrer-Policy: no-referrer.
  // upgrade-insecure-requests is dropped so a local demo over plain HTTP (a phone on the LAN) works;
  // in production TLS terminates at the edge, which also sets HSTS.
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }));
  app.use(express.json({ limit: '10kb' }));

  // Access log: method, path and status only. Never query strings (CDN signatures) or bodies (share tokens).
  app.use((req, res, next) => {
    const started = clock();
    res.on('finish', () => {
      console.log(
        JSON.stringify({ level: 'info', msg: 'http', method: req.method, path: req.path, status: res.statusCode, ms: clock() - started }),
      );
    });
    next();
  });

  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  // Cloud Run reserves paths ending in "z", so /health is the one to use there.
  app.get(['/healthz', '/health'], (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(adminRouter({ shareService, shares, orgs, sessions, audit }));
  app.use(publicRouter({ playback, grants }));
  app.use(cdnRouter(cdn, orgs));
  app.use(['/api', '/cdn'], () => {
    throw new AppError(404, 'not_found', 'Not found');
  });

  // Serve the built Angular app (single-page app, so unknown paths fall back to index.html).
  const staticDir = config.staticDir ? path.resolve(config.staticDir) : undefined;
  if (staticDir && existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: false }));
    app.get('/*splat', (_req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  app.use(errorHandler);

  return { app, ctx: { orgs, sessions, shares, audit, grants, cdn, playback, shareService } };
}
