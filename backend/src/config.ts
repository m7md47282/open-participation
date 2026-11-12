import { randomBytes } from 'node:crypto';

export interface Config {
  port: number;
  /** Base URL used to build share links and signed CDN URLs. */
  publicBaseUrl: string;
  /** HMAC key for playback grants. Separate from the CDN key so one leak does not compromise the other. */
  grantSigningKey: string;
  /** HMAC key shared between the backend and the CDN for signed URLs. */
  cdnSigningKey: string;
  /** How long a signed CDN URL stays valid. Bounds how long playback survives a deactivation. */
  cdnUrlTtlSeconds: number;
  /** How long a playback grant (used for refresh and close) stays valid. */
  grantTtlSeconds: number;
  /** Open guest sessions with no heartbeat for this long are closed automatically. */
  sessionIdleTimeoutSeconds: number;
  redeemLimitPerIpPerMinute: number;
  redeemLimitPerSharePerMinute: number;
  /** Express "trust proxy" setting, so req.ip is the client IP behind a load balancer. */
  trustProxy: boolean | number;
  /** Directory holding the built Angular app, served as static files when present. */
  staticDir?: string;
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function secretEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value && value.length >= 32) return value;
  if (env.NODE_ENV === 'production') {
    throw new Error(`${name} must be set to at least 32 characters in production`);
  }
  console.warn(`[config] ${name} not set; using a random key for this process only`);
  return randomBytes(32).toString('hex');
}

function trustProxyEnv(raw: string | undefined): boolean | number {
  if (!raw) return false;
  if (raw === 'true') return true;
  const hops = Number.parseInt(raw, 10);
  return Number.isFinite(hops) ? hops : false;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = intEnv(env, 'PORT', 3000);
  return {
    port,
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
    grantSigningKey: secretEnv(env, 'GRANT_SIGNING_KEY'),
    cdnSigningKey: secretEnv(env, 'CDN_SIGNING_KEY'),
    cdnUrlTtlSeconds: intEnv(env, 'CDN_URL_TTL_SECONDS', 300),
    grantTtlSeconds: intEnv(env, 'GRANT_TTL_SECONDS', 4 * 60 * 60),
    sessionIdleTimeoutSeconds: intEnv(env, 'SESSION_IDLE_TIMEOUT_SECONDS', 15 * 60),
    redeemLimitPerIpPerMinute: intEnv(env, 'REDEEM_LIMIT_PER_IP_PER_MINUTE', 20),
    redeemLimitPerSharePerMinute: intEnv(env, 'REDEEM_LIMIT_PER_SHARE_PER_MINUTE', 120),
    trustProxy: trustProxyEnv(env.TRUST_PROXY),
    staticDir: env.STATIC_DIR,
  };
}
