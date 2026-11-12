import { randomUUID } from 'node:crypto';
import type { Clock } from '../lib/clock.js';

/**
 * STUB of the existing session service that powers reporting.
 * Every playback creates a session and closes it when playback ends.
 *
 * The one extension for this feature: the actor can be a share guest instead of a user.
 * A share guest session carries the share ID and a random per-session participant ID,
 * and no personal data.
 */

export type Actor =
  | { type: 'user'; userId: string }
  | { type: 'share_guest'; shareId: string; participantId: string };

export type CloseReason = 'completed' | 'abandoned' | 'idle_timeout' | 'share_deactivated' | 'content_disabled';

export interface Session {
  id: string;
  orgId: string;
  contentId: string;
  actor: Actor;
  status: 'open' | 'closed';
  startedAt: string;
  lastSeenAt: string;
  endedAt?: string;
  closeReason?: CloseReason;
}

export class SessionService {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly clock: Clock) {}

  create(input: { orgId: string; contentId: string; actor: Actor }): Session {
    const now = new Date(this.clock()).toISOString();
    const session: Session = {
      id: `ses_${randomUUID()}`,
      orgId: input.orgId,
      contentId: input.contentId,
      actor: input.actor,
      status: 'open',
      startedAt: now,
      lastSeenAt: now,
    };
    this.sessions.set(session.id, session);
    return { ...session };
  }

  heartbeat(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session?.status === 'open') session.lastSeenAt = new Date(this.clock()).toISOString();
  }

  /** Idempotent: closing a closed session returns it unchanged. */
  close(sessionId: string, reason: CloseReason): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    if (session.status === 'open') {
      session.status = 'closed';
      session.endedAt = new Date(this.clock()).toISOString();
      session.closeReason = reason;
    }
    return { ...session };
  }

  get(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    return session ? { ...session } : undefined;
  }

  list(filter: { orgId?: string; shareId?: string; status?: Session['status'] } = {}): Session[] {
    return [...this.sessions.values()]
      .filter((s) => !filter.orgId || s.orgId === filter.orgId)
      .filter((s) => !filter.shareId || (s.actor.type === 'share_guest' && s.actor.shareId === filter.shareId))
      .filter((s) => !filter.status || s.status === filter.status)
      .map((s) => ({ ...s }));
  }
}
