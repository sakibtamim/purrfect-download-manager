import { create } from 'zustand';
import { Store, load } from '@tauri-apps/plugin-store';
import { flushSync } from 'react-dom';

type ThemeMode = 'dark' | 'light' | 'system';
type ResolvedTheme = 'dark' | 'light';

const mockStore = new Map<string, unknown>();
let themeStoreCache: Store | null = null;

async function getThemeStore() {
  if (!themeStoreCache) {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      themeStoreCache = await load('settings.json');
    } else {
      themeStoreCache = {
        get: async <T>(key: string) => (mockStore.get(key) ?? null) as T | null,
        set: async (key: string, value: unknown) => { mockStore.set(key, value); },
        save: async () => {}
      } as unknown as Store;
    }
  }
  return themeStoreCache;
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Temporarily disables all CSS transitions across the entire DOM tree
 * so that when the theme class changes, all elements update synchronously
 * without disparate, lagging color-bleed animations.
 */
function disableTransitions() {
  if (typeof document === 'undefined') return () => {};
  const css = document.createElement('style');
  css.appendChild(
    document.createTextNode(
      '*,*::before,*::after{-webkit-transition:none!important;-moz-transition:none!important;-o-transition:none!important;-ms-transition:none!important;transition:none!important}'
    )
  );
  document.head.appendChild(css);

  return () => {
    // Force a restyle/reflow so the class changes take effect without transition
    (() => window.getComputedStyle(document.body))();

    // Re-enable transitions on the next frames so user interactions/hover work smoothly
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (css.parentNode) {
          css.parentNode.removeChild(css);
        }
      });
    });
  };
}

function runSynchronously(fn: () => void) {
  if (typeof document !== 'undefined') {
    try {
      flushSync(fn);
      return;
    } catch {
      // Fallback if flushSync is disallowed in current React execution phase
    }
  }
  fn();
}

function applyThemeChange(resolved: ResolvedTheme, updateState: () => void) {
  if (typeof document === 'undefined') {
    updateState();
    return;
  }

  const html = document.documentElement;
  const isReduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  const performUpdate = () => {
    const enableTransitions = disableTransitions();
    if (resolved === 'dark') {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
    runSynchronously(updateState);
    enableTransitions();
  };

  if ('startViewTransition' in document && !isReduced) {
    try {
      (document as unknown as { startViewTransition: (cb: () => void) => void }).startViewTransition(() => {
        performUpdate();
      });
      return;
    } catch (err) {
      console.debug("View transition fallback:", err);
      // Fallback if browser throws on transition invocation
    }
  }

  performUpdate();
}

export interface ThemeState {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  initTheme: () => Promise<void>;
  setTheme: (theme: ThemeMode) => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: 'dark',
  resolvedTheme: 'dark',

  initTheme: async () => {
    const store = await getThemeStore();
    const saved = await store.get<ThemeMode>('theme');
    const theme = saved || 'dark';
    const resolved = theme === 'system' ? getSystemTheme() : theme;

    // Apply cleanly without animation on initial load
    if (typeof document !== 'undefined') {
      const enable = disableTransitions();
      const html = document.documentElement;
      if (resolved === 'dark') {
        html.classList.add('dark');
      } else {
        html.classList.remove('dark');
      }
      enable();
    }
    set({ theme, resolvedTheme: resolved });
  },

  setTheme: async (theme: ThemeMode) => {
    const resolved = theme === 'system' ? getSystemTheme() : theme;

    // 1. Immediately apply visual transition (0ms UI latency, unified cross-fade)
    applyThemeChange(resolved, () => {
      set({ theme, resolvedTheme: resolved });
    });

    // 2. Persist to storage in background
    try {
      const store = await getThemeStore();
      await store.set('theme', theme);
      await store.save();
    } catch (err) {
      console.warn('Failed to save theme setting:', err);
    }
  },
}));
