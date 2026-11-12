import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ApiService, Redeemed } from '../api.service';
import { ThemeSwitch } from '../theme-switch';

interface Chapter {
  title: string;
  startSeconds: number;
}

interface Manifest {
  contentId: string;
  title: string;
  durationSeconds: number;
  description: string;
  chapters: Chapter[];
  segments: string[];
}

type State = 'loading' | 'playing' | 'finished' | 'ended' | 'invalid' | 'error';

/** Demo playback runs faster than real time so a whole lesson can be shown in about a minute. */
const DEMO_SPEED = 10;

/**
 * The lesson page a QR code opens. The share token arrives in the URL fragment (/play#token),
 * which browsers never send to servers. It is removed from the address bar straight away.
 * The lesson itself (description, chapters) is loaded from the CDN through the signed URL.
 */
@Component({
  selector: 'app-play-page',
  imports: [ThemeSwitch],
  templateUrl: './play.page.html',
})
export class PlayPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);

  protected readonly state = signal<State>('loading');
  protected readonly message = signal('');
  protected readonly title = signal('');
  protected readonly manifest = signal<Manifest | null>(null);
  protected readonly elapsed = signal(0);
  protected readonly paused = signal(false);

  protected readonly duration = computed(() => this.manifest()?.durationSeconds ?? 0);
  protected readonly progress = computed(() => {
    const total = this.duration();
    return total ? Math.min(100, Math.round((this.elapsed() / total) * 100)) : 0;
  });
  protected readonly chapters = computed(() => {
    const list = this.manifest()?.chapters ?? [];
    const total = this.duration();
    return list.map((c, i) => {
      const end = list[i + 1]?.startSeconds ?? total;
      return { ...c, index: i + 1, lengthSeconds: end - c.startSeconds, endSeconds: end };
    });
  });
  protected readonly currentChapter = computed(() => {
    const t = this.elapsed();
    const list = this.chapters();
    return [...list].reverse().find((c) => t >= c.startSeconds) ?? list[0];
  });
  protected readonly completedChapters = computed(() => this.chapters().filter((c) => this.elapsed() >= c.endSeconds).length);

  private redeemed: Redeemed | null = null;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private tickTimer?: ReturnType<typeof setInterval>;
  private readonly onPageHide = () => {
    if (this.redeemed && this.state() === 'playing') this.api.closeOnUnload(this.redeemed.grant);
  };
  /**
   * Opening another share link in the same tab only changes the fragment, which does not
   * reload the page. Close the current session and start fresh with the new link.
   */
  private readonly onHashChange = () => {
    if (!window.location.hash.slice(1)) return;
    this.onPageHide();
    window.location.reload();
  };

  async ngOnInit(): Promise<void> {
    window.addEventListener('hashchange', this.onHashChange);
    const token = window.location.hash.slice(1);
    history.replaceState(null, '', window.location.pathname);
    if (!token) {
      this.fail('invalid', 'This link is missing its code. Scan the QR code again.');
      return;
    }
    window.addEventListener('pagehide', this.onPageHide);

    try {
      this.redeemed = await this.api.redeem(token);
      this.title.set(this.redeemed.content.title);
      this.manifest.set(await this.api.cdn<Manifest>(this.redeemed.playback.url));
      this.state.set('playing');
      this.scheduleRefresh(this.redeemed.refreshAfterSeconds);
      this.tickTimer = setInterval(() => {
        if (this.paused()) return;
        this.elapsed.update((s) => Math.min(this.duration(), s + DEMO_SPEED));
        if (this.progress() >= 100) void this.finish();
      }, 1000);
    } catch (err) {
      this.handleError(err);
    }
  }

  ngOnDestroy(): void {
    this.stopTimers();
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('hashchange', this.onHashChange);
  }

  togglePause(): void {
    this.paused.update((p) => !p);
  }

  /** Jump to a chapter. Only chapters already reached can be revisited; skipping ahead is not allowed. */
  goTo(startSeconds: number): void {
    if (startSeconds <= this.elapsed()) this.elapsed.set(startSeconds);
  }

  async finish(): Promise<void> {
    if (!this.redeemed || this.state() !== 'playing') return;
    this.stopTimers();
    this.state.set('finished');
    try {
      await this.api.close(this.redeemed.grant, 'completed');
    } catch {
      // The idle sweep closes the session server side if this call is lost.
    }
  }

  time(seconds: number): string {
    const s = Math.max(0, Math.round(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  minutes(seconds: number): string {
    return `${Math.max(1, Math.round(seconds / 60))} min`;
  }

  private scheduleRefresh(afterSeconds: number): void {
    this.refreshTimer = setTimeout(async () => {
      if (!this.redeemed) return;
      try {
        const res = await this.api.refresh(this.redeemed.grant);
        this.scheduleRefresh(res.refreshAfterSeconds);
      } catch (err) {
        this.handleError(err);
      }
    }, afterSeconds * 1000);
  }

  private handleError(err: unknown): void {
    this.stopTimers();
    if (err instanceof HttpErrorResponse) {
      if (err.status === 404) return this.fail('invalid', 'This link is not valid or is no longer active.');
      if (err.status === 410) return this.fail('ended', err.error?.message ?? 'This session has ended.');
      if (err.status === 429) return this.fail('error', 'Too many attempts. Wait a minute and try again.');
    }
    this.fail('error', 'Something went wrong. Please try again.');
  }

  private fail(state: State, message: string): void {
    this.state.set(state);
    this.message.set(message);
  }

  private stopTimers(): void {
    clearTimeout(this.refreshTimer);
    clearInterval(this.tickTimer);
  }
}
