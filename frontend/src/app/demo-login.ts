/**
 * Stands in for the platform's login cookie. When you pick a user in the admin page's
 * "Signed in as" menu, that choice is remembered in this browser, and share links opened
 * here are recorded under that user's name. Nothing is remembered until you pick someone,
 * so by default share links play anonymously.
 */
const KEY = 'op.demo-login';

export function readDemoLogin(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveDemoLogin(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    // Storage blocked: share links simply play anonymously.
  }
}
