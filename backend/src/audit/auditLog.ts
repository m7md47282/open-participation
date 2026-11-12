import { randomUUID } from 'node:crypto';
import type { Clock } from '../lib/clock.js';

/**
 * Append-only audit trail for SOC 2: who changed which share, and when.
 * Events never contain share tokens or personal data about guests.
 * In production this would go to an immutable store (for example WORM storage or the SIEM).
 */

export type AuditAction = 'share.created' | 'share.deactivated' | 'share.reactivated';

export interface AuditEvent {
  id: string;
  at: string;
  orgId: string;
  actor: { type: 'user'; userId: string };
  action: AuditAction;
  targetId: string;
  details?: Record<string, string | number | boolean>;
}

export class AuditLog {
  private readonly events: AuditEvent[] = [];

  constructor(private readonly clock: Clock) {}

  record(event: Omit<AuditEvent, 'id' | 'at'>): AuditEvent {
    const full: AuditEvent = { id: `aud_${randomUUID()}`, at: new Date(this.clock()).toISOString(), ...event };
    this.events.push(Object.freeze(full));
    console.log(JSON.stringify({ level: 'info', msg: 'audit', ...full }));
    return full;
  }

  listByOrg(orgId: string): AuditEvent[] {
    return this.events.filter((e) => e.orgId === orgId);
  }
}
