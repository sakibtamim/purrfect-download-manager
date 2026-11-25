// src/lib/aria2Client.ts
export interface Aria2Download {
  gid: string;
  status: "active" | "waiting" | "paused" | "error" | "complete" | "removed" | "muxing";
  totalLength: string;
  completedLength: string;
  downloadSpeed: string;
  dir: string;
  files: { 
    path: string; 
    length: string; 
    completedLength: string;
    uris: { status: string; uri: string }[];
  }[];
  errorMessage?: string;
  addedAt?: number;
  bitfield?: string;
  numPieces?: string;
  connections?: string;
  pieceLength?: string;
  muxProgress?: number;
}

export interface Aria2Config {
  port: number;
  secret: string;
}

export class Aria2Client {
  // Default fallback port for test / non-Tauri environments before dynamic discovery
  public port = 6800;
  public rpcUrl = "http://127.0.0.1:6800/jsonrpc";
  private idCount = 0;
  private secretToken: string | null = null;
  private configPromise: Promise<{ port: number; secret: string | null }> | null = null;
  private isConfigInitialized = false;
  private tauriFetchFn: typeof fetch | null = null;

  constructor() {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      this.getConfig().catch(() => {});
    }
  }

  getPort(): number {
    return this.port;
  }

  getRpcUrl(): string {
    return this.rpcUrl;
  }

  resetConfig() {
    this.port = 6800;
    this.rpcUrl = "http://127.0.0.1:6800/jsonrpc";
    this.secretToken = null;
    this.isConfigInitialized = false;
    this.configPromise = null;
    this.tauriFetchFn = null;
  }

  async getConfig(): Promise<{ port: number; secret: string | null }> {
    if (this.isConfigInitialized) {
      return { port: this.port, secret: this.secretToken };
    }
    if (!this.configPromise) {
      this.configPromise = (async () => {
        if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
          let invoke: typeof import('@tauri-apps/api/core').invoke;
          try {
            const core = await import('@tauri-apps/api/core');
            invoke = core.invoke;
          } catch (e) {
            console.warn('Failed to access Tauri core api:', e);
            return { port: this.port, secret: this.secretToken };
          }

          try {
            const config = await invoke<{ port: number; secret: string }>('get_aria2_config');
            if (config && typeof config === 'object' && typeof config.port === 'number' && config.port > 0) {
              this.port = config.port;
              this.rpcUrl = `http://127.0.0.1:${this.port}/jsonrpc`;
              this.secretToken = config.secret && config.secret.trim() ? config.secret.trim() : null;
              this.isConfigInitialized = true;
              return { port: this.port, secret: this.secretToken };
            }
          } catch (configErr: unknown) {
            const errMsg = configErr instanceof Error ? configErr.message : String(configErr);
            // Only fall back to get_aria2_secret if get_aria2_config command is not found (legacy backend)
            if (errMsg.toLowerCase().includes('not found')) {
              console.warn('Failed to retrieve aria2 config via get_aria2_config, falling back:', configErr);
              try {
                const secret = await invoke<string>('get_aria2_secret');
                if (typeof secret === 'string') {
                  this.secretToken = secret.trim() ? secret.trim() : null;
                  this.isConfigInitialized = true;
                  return { port: this.port, secret: this.secretToken };
                }
              } catch (e) {
                console.warn('Failed to retrieve aria2 secret from Tauri:', e);
              }
            } else {
              console.error('Failed to retrieve aria2 dynamic config:', configErr);
              throw configErr;
            }
          }
        }
        return { port: this.port, secret: this.secretToken };
      })();
    }
    try {
      const result = await this.configPromise;
      if (!this.isConfigInitialized) {
        this.configPromise = null;
      }
      return result;
    } catch (err) {
      this.configPromise = null;
      throw err;
    }
  }

  async getSecret(): Promise<string | null> {
    if (this.secretToken !== null) {
      return this.secretToken;
    }
    const config = await this.getConfig();
    return config.secret;
  }

  setSecret(token: string | null) {
    this.secretToken = token && token.trim() ? token.trim() : null;
    this.isConfigInitialized = true;
    this.configPromise = null;
  }

  setConfig(config: { port?: number; secret?: string | null }) {
    if (typeof config.port === 'number' && config.port > 0) {
      this.port = config.port;
      this.rpcUrl = `http://127.0.0.1:${this.port}/jsonrpc`;
    }
    if (config.secret !== undefined) {
      this.secretToken = config.secret && config.secret.trim() ? config.secret.trim() : null;
    }
    this.isConfigInitialized = true;
    this.configPromise = null;
  }

  private async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const config = await this.getConfig();
    const secret = config.secret;
    const finalParams = secret ? [`token:${secret}`, ...params] : params;
    const id = `pdm-${++this.idCount}`;

    let fetchFn: typeof fetch = fetch;
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      if (this.tauriFetchFn) {
        fetchFn = this.tauriFetchFn;
      } else {
        try {
          const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
          const hasTauriIpc = typeof (window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === 'function';
          if (typeof tauriFetch === 'function' && (hasTauriIpc || process.env.NODE_ENV !== 'test')) {
            this.tauriFetchFn = tauriFetch;
            fetchFn = tauriFetch;
          }
        } catch (err) {
          console.warn('Failed to load @tauri-apps/plugin-http, falling back to global fetch:', err);
        }
      }
    }

    const requestOptions = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: `aria2.${method}`,
        params: finalParams,
      }),
    };

    let response: Response;
    try {
      response = await fetchFn(this.rpcUrl, requestOptions);
    } catch (err: unknown) {
      if (fetchFn !== fetch) {
        response = await fetch(this.rpcUrl, requestOptions);
      } else {
        throw err;
      }
    }

    if (!response.ok) {
      throw new Error(`Aria2 RPC Error: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message);
    }

    return data.result as T;
  }

  async addUri(uris: string[], options?: Record<string, string | string[]>): Promise<string> {
    return this.call<string>("addUri", [uris, options || {}]);
  }

  async pause(gid: string): Promise<string> {
    return this.call<string>("pause", [gid]);
  }

  async unpause(gid: string): Promise<string> {
    return this.call<string>("unpause", [gid]);
  }

  async pauseAll(): Promise<string> {
    return this.call<string>("pauseAll");
  }

  async unpauseAll(): Promise<string> {
    return this.call<string>("unpauseAll");
  }

  async remove(gid: string): Promise<string> {
    return this.call<string>("remove", [gid]);
  }

  async removeDownloadResult(gid: string): Promise<string> {
    return this.call<string>("removeDownloadResult", [gid]);
  }

  async purgeDownloadResult(): Promise<string> {
    return this.call<string>("purgeDownloadResult");
  }

  async tellActive(keys?: string[]): Promise<Aria2Download[]> {
    return this.call<Aria2Download[]>("tellActive", keys ? [keys] : []);
  }

  async tellWaiting(offset: number, num: number, keys?: string[]): Promise<Aria2Download[]> {
    return this.call<Aria2Download[]>("tellWaiting", keys ? [offset, num, keys] : [offset, num]);
  }

  async tellStopped(offset: number, num: number, keys?: string[]): Promise<Aria2Download[]> {
    return this.call<Aria2Download[]>("tellStopped", keys ? [offset, num, keys] : [offset, num]);
  }

  async getGlobalStat(): Promise<{ downloadSpeed: string; numActive: string; numStopped: string; numWaiting: string }> {
    return this.call("getGlobalStat");
  }

  async changeGlobalOption(options: Record<string, string>): Promise<string> {
    return this.call("changeGlobalOption", [options]);
  }

  async getOption(gid: string): Promise<Record<string, string>> {
    return this.call("getOption", [gid]);
  }

  async getGlobalOption(): Promise<Record<string, string>> {
    return this.call("getGlobalOption");
  }
}

export const aria2Client = new Aria2Client();
