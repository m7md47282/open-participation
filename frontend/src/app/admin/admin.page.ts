import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ThemeSwitch } from '../theme-switch';
import { ApiService, AuditEvent, ContentItem, CreatedShare, ReportRow, Share } from '../api.service';

const DEMO_LOGINS = [
  { token: 'demo-admin-acme', label: 'Alice, admin at Acme Construction' },
  { token: 'demo-admin-globex', label: 'Carol, admin at Globex Energy' },
  { token: 'demo-learner-acme', label: 'Bob, learner at Acme (not an admin)' },
];

@Component({
  selector: 'app-admin-page',
  imports: [FormsModule, DatePipe, RouterLink, ThemeSwitch],
  templateUrl: './admin.page.html',
})
export class AdminPage implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly logins = DEMO_LOGINS;
  protected readonly login = signal(DEMO_LOGINS[0]!.token);
  protected readonly me = signal<{ displayName: string; orgName: string } | null>(null);
  protected readonly content = signal<ContentItem[]>([]);
  protected readonly shares = signal<Share[]>([]);
  protected readonly report = signal<ReportRow[]>([]);
  protected readonly audit = signal<AuditEvent[]>([]);
  protected readonly created = signal<CreatedShare | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected selectedContentId = '';
  protected label = '';

  protected readonly shareableContent = computed(() => this.content().filter((c) => c.shareable));
  protected readonly guestRows = computed(() => this.report().filter((r) => r.source === 'share').length);

  ngOnInit(): void {
    void this.load();
  }

  async switchLogin(token: string): Promise<void> {
    this.login.set(token);
    this.created.set(null);
    await this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    try {
      const token = this.login();
      const [me, content, shares, report, audit] = await Promise.all([
        this.api.me(token),
        this.api.content(token),
        this.api.shares(token),
        this.api.report(token),
        this.api.audit(token),
      ]);
      this.me.set(me);
      this.content.set(content.content);
      this.shares.set(shares.shares);
      this.report.set(report.sessions);
      this.audit.set([...audit.events].reverse());
      if (!this.shareableContent().some((c) => c.id === this.selectedContentId)) {
        this.selectedContentId = this.shareableContent()[0]?.id ?? '';
      }
    } catch (err) {
      this.me.set(null);
      this.content.set([]);
      this.shares.set([]);
      this.report.set([]);
      this.audit.set([]);
      this.error.set(messageOf(err));
    }
  }

  async createShare(): Promise<void> {
    if (!this.selectedContentId) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.created.set(await this.api.createShare(this.login(), this.selectedContentId, this.label));
      this.label = '';
      await this.load();
    } catch (err) {
      this.error.set(messageOf(err));
    } finally {
      this.busy.set(false);
    }
  }

  async toggle(share: Share): Promise<void> {
    this.error.set(null);
    try {
      await this.api.setStatus(this.login(), share.id, share.status === 'active' ? 'inactive' : 'active');
      await this.load();
    } catch (err) {
      this.error.set(messageOf(err));
    }
  }

  dismissCreated(): void {
    this.created.set(null);
  }

  scopeLabel(item: ContentItem): string {
    return item.scope.type === 'org' ? 'Whole organisation' : `Groups: ${item.scope.groupIds.join(', ')}`;
  }
}

function messageOf(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    return err.error?.message ?? `Request failed (${err.status})`;
  }
  return 'Something went wrong';
}
