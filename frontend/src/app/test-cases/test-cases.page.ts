import { Component, ElementRef, OnInit, computed, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { marked } from 'marked';
import { ThemeSwitch } from '../theme-switch';
// Bundled at build time from the repository root, so this page always matches the document.
import testCasesMarkdown from '../../../../TEST_CASES.md';

interface Counts {
  total: number;
  automated: number;
  manual: number;
}

/**
 * Renders TEST_CASES.md from the repository root, so the document and this page
 * can never disagree. Adds a summary and a filter on top.
 */
@Component({
  selector: 'app-test-cases-page',
  imports: [RouterLink, ThemeSwitch],
  templateUrl: './test-cases.page.html',
})
export class TestCasesPage implements OnInit {
  private readonly doc = viewChild<ElementRef<HTMLElement>>('doc');

  protected readonly html = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly counts = signal<Counts>({ total: 0, automated: 0, manual: 0 });
  protected readonly query = signal('');
  protected readonly visible = signal(0);
  protected readonly filtering = computed(() => this.query().trim().length > 0);

  async ngOnInit(): Promise<void> {
    try {
      const markdown = testCasesMarkdown;
      this.counts.set(countCases(markdown));
      this.visible.set(this.counts().total);
      // Angular sanitises [innerHTML], and the file is our own, bundled at build time.
      this.html.set(await marked.parse(markdown));
      queueMicrotask(() => this.decorateTables());
    } catch {
      this.error.set('Could not load the test cases.');
    }
  }

  onFilter(value: string): void {
    this.query.set(value);
    const needle = value.trim().toLowerCase();
    const root = this.doc()?.nativeElement;
    if (!root) return;
    let shown = 0;
    for (const row of Array.from(root.querySelectorAll<HTMLTableRowElement>('tbody tr'))) {
      const isCase = /^TC-\d+/.test(row.cells[0]?.textContent ?? '');
      const match = !needle || !isCase || (row.textContent ?? '').toLowerCase().includes(needle);
      row.hidden = !match;
      if (isCase && match) shown += 1;
    }
    this.visible.set(shown);
  }

  /** Wraps each table so it scrolls on its own on small screens, and marks the source of each case. */
  private decorateTables(): void {
    const root = this.doc()?.nativeElement;
    if (!root) return;
    for (const table of Array.from(root.querySelectorAll('table'))) {
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      wrap.tabIndex = 0;
      wrap.setAttribute('role', 'region');
      const heading = table.previousElementSibling?.textContent ?? 'Table';
      wrap.setAttribute('aria-label', heading);
      table.replaceWith(wrap);
      wrap.appendChild(table);
    }
    for (const cell of Array.from(root.querySelectorAll<HTMLTableCellElement>('tbody td:last-child'))) {
      const text = cell.textContent ?? '';
      if (/^(API|UI)/.test(text)) cell.classList.add('cov-auto');
      else if (/^Manual/.test(text)) cell.classList.add('cov-manual');
    }
  }
}

function countCases(markdown: string): Counts {
  const rows = markdown.split('\n').filter((line) => /^\|\s*TC-\d+/.test(line));
  const manual = rows.filter((line) => {
    const cells = line.split('|').map((c) => c.trim());
    return /^Manual/.test(cells[cells.length - 2] ?? '');
  }).length;
  return { total: rows.length, automated: rows.length - manual, manual };
}
