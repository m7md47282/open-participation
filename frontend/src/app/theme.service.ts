import { Injectable, signal } from '@angular/core';

export type ThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'op-theme';

/**
 * Light, dark, or follow the device. The choice is a per-viewer convenience, so it lives in
 * localStorage; if storage is blocked (private mode), the switch still works for the visit.
 * public/theme-init.js applies the saved choice before Angular starts, so there is no flash.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly choice = signal<ThemeChoice>(readStored());

  set(choice: ThemeChoice): void {
    this.choice.set(choice);
    apply(choice);
    try {
      if (choice === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // Storage unavailable: the choice still applies until the page is closed.
    }
  }
}

function readStored(): ThemeChoice {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function apply(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}
