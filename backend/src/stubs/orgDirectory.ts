/**
 * STUB of the existing organisation and content catalogue.
 * Content is enabled for a whole organisation or for specific user groups.
 */

export interface Org {
  id: string;
  name: string;
}

export interface Chapter {
  title: string;
  startSeconds: number;
}

export interface Content {
  id: string;
  title: string;
  durationSeconds: number;
  description?: string;
  chapters?: Chapter[];
}

export type EntitlementScope = { type: 'org' } | { type: 'groups'; groupIds: string[] };

export interface Entitlement {
  orgId: string;
  contentId: string;
  scope: EntitlementScope;
}

export class OrgDirectory {
  private readonly orgs = new Map<string, Org>();
  private readonly content = new Map<string, Content>();
  private entitlements: Entitlement[] = [];

  addOrg(org: Org): void {
    this.orgs.set(org.id, org);
  }

  addContent(item: Content): void {
    this.content.set(item.id, item);
  }

  enable(entitlement: Entitlement): void {
    this.disable(entitlement.orgId, entitlement.contentId);
    this.entitlements.push(entitlement);
  }

  /** Simulates an admin or Pixaera removing content from an organisation. */
  disable(orgId: string, contentId: string): void {
    this.entitlements = this.entitlements.filter((e) => !(e.orgId === orgId && e.contentId === contentId));
  }

  getOrg(orgId: string): Org | undefined {
    return this.orgs.get(orgId);
  }

  getContent(contentId: string): Content | undefined {
    return this.content.get(contentId);
  }

  entitlementFor(orgId: string, contentId: string): Entitlement | undefined {
    return this.entitlements.find((e) => e.orgId === orgId && e.contentId === contentId);
  }

  /**
   * Only content enabled for the whole organisation can be shared publicly.
   * Group-restricted content was deliberately limited to a subset of users,
   * so opening it to anyone with a QR code would bypass that decision.
   */
  isShareable(orgId: string, contentId: string): boolean {
    return this.entitlementFor(orgId, contentId)?.scope.type === 'org';
  }

  listForOrg(orgId: string): Array<Content & { scope: EntitlementScope; shareable: boolean }> {
    return this.entitlements
      .filter((e) => e.orgId === orgId)
      .flatMap((e) => {
        const item = this.content.get(e.contentId);
        return item ? [{ ...item, scope: e.scope, shareable: e.scope.type === 'org' }] : [];
      });
  }
}
