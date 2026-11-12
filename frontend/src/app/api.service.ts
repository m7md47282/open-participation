import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface ContentItem {
  id: string;
  title: string;
  durationSeconds: number;
  scope: { type: 'org' } | { type: 'groups'; groupIds: string[] };
  shareable: boolean;
}

export interface Share {
  id: string;
  orgId: string;
  contentId: string;
  contentTitle: string;
  label: string;
  status: 'active' | 'inactive';
  createdBy: string;
  createdAt: string;
  statusChangedAt?: string;
  stats: { totalSessions: number; openSessions: number };
}

export interface CreatedShare {
  share: Share;
  shareUrl: string;
  qrCodeDataUrl: string;
}

export interface ReportRow {
  sessionId: string;
  contentTitle: string;
  source: 'platform' | 'share';
  participant: string;
  shareId: string | null;
  shareLabel?: string | null;
  status: 'open' | 'closed';
  startedAt: string;
  endedAt: string | null;
  closeReason: string | null;
}

export interface AuditEvent {
  id: string;
  at: string;
  action: string;
  actor: { userId: string };
  targetId: string;
}

export interface Redeemed {
  sessionId: string;
  grant: string;
  grantExpiresAt: string;
  content: { id: string; title: string; durationSeconds: number };
  playback: { url: string; expiresAt: string };
  refreshAfterSeconds: number;
}

/** Thin wrapper over the backend API. The admin token is the stubbed platform login. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  private auth(token: string) {
    return { headers: new HttpHeaders({ Authorization: `Bearer ${token}` }) };
  }

  me(token: string) {
    return firstValueFrom(this.http.get<{ displayName: string; orgName: string; role: string }>('/api/admin/me', this.auth(token)));
  }

  content(token: string) {
    return firstValueFrom(this.http.get<{ content: ContentItem[] }>('/api/admin/content', this.auth(token)));
  }

  shares(token: string) {
    return firstValueFrom(this.http.get<{ shares: Share[] }>('/api/admin/shares', this.auth(token)));
  }

  createShare(token: string, contentId: string, label: string) {
    return firstValueFrom(this.http.post<CreatedShare>('/api/admin/shares', { contentId, label }, this.auth(token)));
  }

  setStatus(token: string, shareId: string, status: 'active' | 'inactive') {
    return firstValueFrom(this.http.patch<{ share: Share }>(`/api/admin/shares/${shareId}`, { status }, this.auth(token)));
  }

  report(token: string) {
    return firstValueFrom(this.http.get<{ sessions: ReportRow[] }>('/api/admin/reports/sessions', this.auth(token)));
  }

  audit(token: string) {
    return firstValueFrom(this.http.get<{ events: AuditEvent[] }>('/api/admin/audit', this.auth(token)));
  }

  redeem(token: string) {
    return firstValueFrom(this.http.post<Redeemed>('/api/public/shares/redeem', { token }));
  }

  refresh(grant: string) {
    return firstValueFrom(
      this.http.post<{ playback: { url: string; expiresAt: string }; refreshAfterSeconds: number }>(
        '/api/public/playback/refresh',
        {},
        this.auth(grant),
      ),
    );
  }

  close(grant: string, reason: 'completed' | 'abandoned') {
    return firstValueFrom(this.http.post('/api/public/playback/close', { reason }, this.auth(grant)));
  }

  /** Used when the tab is closing: keepalive lets the request finish after the page is gone. */
  closeOnUnload(grant: string) {
    void fetch('/api/public/playback/close', {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${grant}` },
      body: JSON.stringify({ reason: 'abandoned' }),
    }).catch(() => undefined);
  }

  /** Fetches from the CDN with the signed URL. Same origin in this demo, so the path is enough. */
  cdn<T>(signedUrl: string) {
    const url = new URL(signedUrl);
    return firstValueFrom(this.http.get<T>(url.pathname + url.search));
  }
}
