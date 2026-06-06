// src/lib/aria2Client.ts
export interface Aria2Download {
  gid: string;
  status: "active" | "waiting" | "paused" | "error" | "complete" | "removed";
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
}

class Aria2Client {
  private rpcUrl = "http://localhost:6800/jsonrpc";
  private idCount = 0;

  private async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const id = `pdm-${++this.idCount}`;
    const response = await fetch(this.rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: `aria2.${method}`,
        params,
      }),
    });

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
