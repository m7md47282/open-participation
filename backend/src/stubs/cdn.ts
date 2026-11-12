import { Router } from 'express';
import type { Clock } from '../lib/clock.js';
import { hmac, safeEqual } from '../lib/crypto.js';
import type { OrgDirectory } from './orgDirectory.js';

/**
 * STUB of the CDN, plus the signer the backend uses to issue URLs for it.
 *
 * A signed URL covers a path prefix (one content item's folder) and an expiry time.
 * The CDN only knows the shared signing key, not who the viewer is. That is how anonymous
 * viewers get playback without the CDN being opened up. This mirrors CloudFront signed
 * URLs or Cloudflare token authentication.
 */

export class CdnSigner {
  constructor(
    private readonly key: string,
    private readonly ttlSeconds: number,
    private readonly clock: Clock,
    private readonly baseUrl: string,
  ) {}

  static prefixFor(contentId: string): string {
    return `/cdn/content/${encodeURIComponent(contentId)}/`;
  }

  signedUrl(contentId: string, file = 'manifest.json'): { url: string; expiresAt: string } {
    const exp = Math.floor(this.clock() / 1000) + this.ttlSeconds;
    const prefix = CdnSigner.prefixFor(contentId);
    const sig = hmac(this.key, `${prefix}|${exp}`);
    return {
      url: `${this.baseUrl}${prefix}${file}?exp=${exp}&sig=${sig}`,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  verify(contentId: string, exp: unknown, sig: unknown): 'ok' | 'expired' | 'invalid' {
    if (typeof exp !== 'string' || typeof sig !== 'string' || !/^\d+$/.test(exp)) return 'invalid';
    const expected = hmac(this.key, `${CdnSigner.prefixFor(contentId)}|${exp}`);
    if (!safeEqual(sig, expected)) return 'invalid';
    if (Number(exp) * 1000 <= this.clock()) return 'expired';
    return 'ok';
  }
}

export function cdnRouter(signer: CdnSigner, orgs: OrgDirectory): Router {
  const router = Router();

  router.get('/cdn/content/:contentId/*file', (req, res) => {
    const { contentId } = req.params;
    const file = ([] as string[]).concat(req.params.file).join('/');
    const result = signer.verify(contentId, req.query.exp, req.query.sig);
    if (result !== 'ok') {
      res.status(403).json({ error: result === 'expired' ? 'url_expired' : 'invalid_signature' });
      return;
    }
    const content = orgs.getContent(contentId);
    if (!content) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    // Viewers may cache privately until the URL expires, but shared caches must not reuse it.
    res.set('Cache-Control', 'private, max-age=60');
    if (file === 'manifest.json') {
      res.json({
        contentId: content.id,
        title: content.title,
        durationSeconds: content.durationSeconds,
        description: content.description ?? '',
        chapters: content.chapters ?? [{ title: content.title, startSeconds: 0 }],
        segments: ['segment-1.bin', 'segment-2.bin', 'segment-3.bin'],
      });
      return;
    }
    res.type('application/octet-stream').send(`stub media bytes for ${content.id}/${file}`);
  });

  return router;
}
