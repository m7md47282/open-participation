/**
 * Share storage. In-memory here; the interface is small so a SQL table can replace it.
 * Only the SHA-256 hash of the share token is kept, never the token itself.
 */

export interface Share {
  id: string;
  orgId: string;
  contentId: string;
  label: string;
  tokenHash: string;
  status: 'active' | 'inactive';
  createdBy: string;
  createdAt: string;
  statusChangedAt?: string;
  statusChangedBy?: string;
}

export class ShareRepository {
  private readonly byId = new Map<string, Share>();
  private readonly idByTokenHash = new Map<string, string>();

  insert(share: Share): void {
    this.byId.set(share.id, { ...share });
    this.idByTokenHash.set(share.tokenHash, share.id);
  }

  get(id: string): Share | undefined {
    const share = this.byId.get(id);
    return share ? { ...share } : undefined;
  }

  findByTokenHash(tokenHash: string): Share | undefined {
    const id = this.idByTokenHash.get(tokenHash);
    return id ? this.get(id) : undefined;
  }

  update(id: string, patch: Partial<Pick<Share, 'status' | 'statusChangedAt' | 'statusChangedBy'>>): Share | undefined {
    const share = this.byId.get(id);
    if (!share) return undefined;
    Object.assign(share, patch);
    return { ...share };
  }

  listByOrg(orgId: string): Share[] {
    return [...this.byId.values()].filter((s) => s.orgId === orgId).map((s) => ({ ...s }));
  }
}
