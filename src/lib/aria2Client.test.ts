import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Aria2Client } from './aria2Client';

describe('Aria2Client', () => {
  let client: Aria2Client;

  beforeEach(() => {
    client = new Aria2Client();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it('prepends token parameter when secret token is set', async () => {
    client.setSecret('test-secret-123');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'pdm-1', jsonrpc: '2.0', result: 'OK' }),
    });
    global.fetch = fetchMock;

    await client.addUri(['https://example.com/file.zip'], { out: 'file.zip' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.method).toBe('aria2.addUri');
    expect(body.params[0]).toBe('token:test-secret-123');
    expect(body.params[1]).toEqual(['https://example.com/file.zip']);
    expect(body.params[2]).toEqual({ out: 'file.zip' });
  });

  it('sends parameters without token when no secret is configured', async () => {
    client.setSecret(null);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'pdm-1', jsonrpc: '2.0', result: [] }),
    });
    global.fetch = fetchMock;

    await client.tellActive(['gid', 'status']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.method).toBe('aria2.tellActive');
    expect(body.params[0]).toEqual(['gid', 'status']);
  });

  it('retrieves config and secret from Tauri invoke get_aria2_config when available', async () => {
    const invokeMock = vi.fn().mockImplementation(async (cmd: string) => {
      if (cmd === 'get_aria2_config') {
        return { port: 6812, secret: 'ephemeral-token-xyz' };
      }
      return null;
    });
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: invokeMock,
    }));

    (globalThis as unknown as { window: unknown }).window = { __TAURI_INTERNALS__: {} };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'pdm-1', jsonrpc: '2.0', result: { downloadSpeed: '0' } }),
    });
    global.fetch = fetchMock;

    await client.getGlobalStat();

    expect(invokeMock).toHaveBeenCalledWith('get_aria2_config');
    expect(client.getPort()).toBe(6812);
    expect(client.getRpcUrl()).toBe('http://127.0.0.1:6812/jsonrpc');
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:6812/jsonrpc');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.method).toBe('aria2.getGlobalStat');
    expect(body.params[0]).toBe('token:ephemeral-token-xyz');
  });

  it('falls back to get_aria2_secret and default port 6800 when get_aria2_config is unavailable', async () => {
    const invokeMock = vi.fn().mockImplementation(async (cmd: string) => {
      if (cmd === 'get_aria2_config') {
        throw new Error('Command get_aria2_config not found');
      }
      if (cmd === 'get_aria2_secret') {
        return 'legacy-token-abc';
      }
      return null;
    });
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: invokeMock,
    }));

    (globalThis as unknown as { window: unknown }).window = { __TAURI_INTERNALS__: {} };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'pdm-1', jsonrpc: '2.0', result: { downloadSpeed: '0' } }),
    });
    global.fetch = fetchMock;

    await client.getGlobalStat();

    expect(invokeMock).toHaveBeenCalledWith('get_aria2_config');
    expect(invokeMock).toHaveBeenCalledWith('get_aria2_secret');
    expect(client.getPort()).toBe(6800);
    expect(client.getRpcUrl()).toBe('http://127.0.0.1:6800/jsonrpc');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.params[0]).toBe('token:legacy-token-abc');
  });

  it('defaults to port 6800 and rpcUrl http://127.0.0.1:6800/jsonrpc in non-Tauri environment', async () => {
    expect(client.getPort()).toBe(6800);
    expect(client.getRpcUrl()).toBe('http://127.0.0.1:6800/jsonrpc');

    const config = await client.getConfig();
    expect(config.port).toBe(6800);
    expect(config.secret).toBeNull();
  });

  it('updates port and rpcUrl dynamically via setConfig', async () => {
    client.setConfig({ port: 6815, secret: 'dynamic-secret' });
    expect(client.getPort()).toBe(6815);
    expect(client.getRpcUrl()).toBe('http://127.0.0.1:6815/jsonrpc');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'pdm-1', jsonrpc: '2.0', result: 'OK' }),
    });
    global.fetch = fetchMock;

    await client.pause('gid-test');
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:6815/jsonrpc');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.params[0]).toBe('token:dynamic-secret');
  });

  it('handles changeGlobalOption with secret', async () => {
    client.setSecret('global-secret');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'pdm-1', jsonrpc: '2.0', result: 'OK' }),
    });
    global.fetch = fetchMock;

    await client.changeGlobalOption({ dir: '/downloads/custom' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.method).toBe('aria2.changeGlobalOption');
    expect(body.params[0]).toBe('token:global-secret');
    expect(body.params[1]).toEqual({ dir: '/downloads/custom' });
  });

  it('throws when aria2 JSON-RPC response contains error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'pdm-1',
        jsonrpc: '2.0',
        error: { code: 1, message: 'Unauthorized' },
      }),
    });
    global.fetch = fetchMock;

    await expect(client.tellActive()).rejects.toThrow('Unauthorized');
  });

  it('throws when fetch fails with non-ok HTTP status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Bad Gateway',
    });
    global.fetch = fetchMock;

    await expect(client.tellActive()).rejects.toThrow('Aria2 RPC Error: Bad Gateway');
  });

  it('falls back to no token when get_aria2_config returns empty string or whitespace', async () => {
    const invokeMock = vi.fn().mockImplementation(async (cmd: string) => {
      if (cmd === 'get_aria2_config') {
        return { port: 6800, secret: '' };
      }
      return '';
    });
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: invokeMock,
    }));

    (globalThis as unknown as { window: unknown }).window = { __TAURI_INTERNALS__: {} };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'pdm-1', jsonrpc: '2.0', result: { downloadSpeed: '0' } }),
    });
    global.fetch = fetchMock;

    await client.getGlobalStat();

    expect(invokeMock).toHaveBeenCalledWith('get_aria2_config');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.params).toEqual([]);
  });

  it('handles Tauri command rejection gracefully and allows subsequent retry', async () => {
    let attempt = 1;
    const invokeMock = vi.fn().mockImplementation(async (cmd: string) => {
      if (attempt === 1) {
        throw new Error('Tauri command not found');
      }
      if (cmd === 'get_aria2_config') {
        return { port: 6814, secret: 'retry-secret-token' };
      }
      return 'retry-secret-token';
    });

    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: invokeMock,
    }));

    (globalThis as unknown as { window: unknown }).window = { __TAURI_INTERNALS__: {} };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'pdm-1', jsonrpc: '2.0', result: { downloadSpeed: '0' } }),
    });
    global.fetch = fetchMock;

    // First attempt: invoke fails for both, calls without token on default 6800
    await client.getGlobalStat();
    let body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.params).toEqual([]);
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:6800/jsonrpc');

    // Second attempt: commands succeed, calls with token on port 6814
    attempt = 2;
    await client.getGlobalStat();
    body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.params[0]).toBe('token:retry-secret-token');
    expect(fetchMock.mock.calls[1][0]).toBe('http://127.0.0.1:6814/jsonrpc');
  });

  it('normalizes empty or whitespace token in setSecret to null', async () => {
    client.setSecret('   ');
    expect(await client.getSecret()).toBeNull();

    client.setSecret('');
    expect(await client.getSecret()).toBeNull();

    client.setSecret('valid-token');
    expect(await client.getSecret()).toBe('valid-token');
  });

  it('throws and does not fallback to 6800 when get_aria2_config fails with port collision error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const invokeMock = vi.fn().mockImplementation(async (cmd: string) => {
      if (cmd === 'get_aria2_config') {
        throw new Error('Failed to find available port for aria2: all ports in range 6800-6820 are occupied');
      }
      return null;
    });
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: invokeMock,
    }));

    (globalThis as unknown as { window: unknown }).window = { __TAURI_INTERNALS__: {} };

    await expect(client.getConfig()).rejects.toThrow('Failed to find available port for aria2');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('resets config via resetConfig to initial defaults', () => {
    client.setConfig({ port: 6818, secret: 'test-secret' });
    expect(client.getPort()).toBe(6818);
    expect(client.getRpcUrl()).toBe('http://127.0.0.1:6818/jsonrpc');

    client.resetConfig();
    expect(client.getPort()).toBe(6800);
    expect(client.getRpcUrl()).toBe('http://127.0.0.1:6800/jsonrpc');
  });
});
