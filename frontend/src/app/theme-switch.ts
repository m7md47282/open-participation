import { Component, inject } from '@angular/core';
import { ThemeChoice, ThemeService } from './theme.service';

/** Three-way theme switch: System, Light, Dark. Each option is a toggle button with a text label for screen readers. */
@Component({
  selector: 'app-theme-switch',
  template: `
    <div class="theme-switch" role="group" aria-label="Colour theme">
      @for (option of options; track option.value) {
        <button
          type="button"
          [attr.aria-pressed]="theme.choice() === option.value"
          [attr.aria-label]="option.label"
          [title]="option.label"
          (click)="theme.set(option.value)"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="currentColor" [attr.d]="option.icon" />
          </svg>
        </button>
      }
    </div>
  `,
})
export class ThemeSwitch {
  protected readonly theme = inject(ThemeService);

  protected readonly options: Array<{ value: ThemeChoice; label: string; icon: string }> = [
    {
      value: 'system',
      label: 'Use device theme',
      icon: 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-6v2h3v2H7v-2h3v-2H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2v8h14V7z',
    },
    {
      value: 'light',
      label: 'Light theme',
      icon: 'M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0-5 1 3h-2zm0 20-1-3h2zM2 12l3-1v2zm20 0-3 1v-2zM4.9 4.9l2.8 1.4-1.4 1.4zm14.2 14.2-2.8-1.4 1.4-1.4zM4.9 19.1l1.4-2.8 1.4 1.4zM19.1 4.9l-1.4 2.8-1.4-1.4z',
    },
    {
      value: 'dark',
      label: 'Dark theme',
      icon: 'M21 14.5A8.5 8.5 0 0 1 9.5 3a7 7 0 1 0 11.5 11.5z',
    },
  ];
}
