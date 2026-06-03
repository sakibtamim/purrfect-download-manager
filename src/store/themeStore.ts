import { create } from 'zustand';
import { Store, load } from '@tauri-apps/plugin-store';

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

function applyThemeClass(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  if (resolved === 'dark') {
    html.classList.add('dark');
  } else {
    html.classList.remove('dark');
  }
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

    applyThemeClass(resolved);
    set({ theme, resolvedTheme: resolved });
  },

  setTheme: async (theme: ThemeMode) => {
    const store = await getThemeStore();
    await store.set('theme', theme);
    await store.save();

    const resolved = theme === 'system' ? getSystemTheme() : theme;
    applyThemeClass(resolved);
    set({ theme, resolvedTheme: resolved });
  },
}));
