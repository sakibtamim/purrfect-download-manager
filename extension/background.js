// Cache state to avoid async delay on every download
let pdmEnabled = true;
chrome.storage.local.get("pdm_enabled").then(data => {
  if (data.pdm_enabled !== undefined) pdmEnabled = data.pdm_enabled;
});
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.pdm_enabled) {
    pdmEnabled = changes.pdm_enabled.newValue;
  }
});

// Cache for dynamically sniffed hashes from content script
// We store by multiple keys for fuzzy matching after redirects
const sniffedHashes = new Map();

function storeHash(url, checksum) {
  if (!checksum || !checksum.algorithm || !checksum.digest) return;
  
  // checksum is { algorithm, digest, source, timestamp }
  const entry = { ...checksum, timestamp: Date.now() };
  sniffedHashes.set(url, entry);

  // Also store by URL path (without query params) for redirect tolerance
  try {
    const parsed = new URL(url);
    const pathKey = parsed.origin + parsed.pathname;
    sniffedHashes.set(pathKey, entry);

    // Also store by just the filename for maximum fuzziness
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length > 0) {
      const filename = segments[segments.length - 1];
      if (filename.length > 3) {
        sniffedHashes.set("__filename__" + filename, entry);
      }
    }
  } catch { /* invalid URL, skip */ }

  // Automatically clean up old hashes after 10 minutes
  setTimeout(() => {
    sniffedHashes.delete(url);
    try {
      const parsed = new URL(url);
      sniffedHashes.delete(parsed.origin + parsed.pathname);
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length > 0) {
        const filename = segments[segments.length - 1];
        if (filename.length > 3) {
          sniffedHashes.delete("__filename__" + filename);
        }
      }
    } catch { /* ignore */ }
  }, 10 * 60 * 1000);
}

function lookupHash(downloadUrl, finalUrl, filename, referrer) {
  // 1. Exact URL match
  let hash = sniffedHashes.get(downloadUrl);
  if (hash) return hash;

  // 2. Final URL match (after redirects)
  if (finalUrl) {
    hash = sniffedHashes.get(finalUrl);
    if (hash) return hash;
  }

  // 3. Try without query params
  try {
    const parsed = new URL(downloadUrl);
    hash = sniffedHashes.get(parsed.origin + parsed.pathname);
    if (hash) return hash;
  } catch { /* ignore */ }

  if (finalUrl) {
    try {
      const parsed = new URL(finalUrl);
      hash = sniffedHashes.get(parsed.origin + parsed.pathname);
      if (hash) return hash;
    } catch { /* ignore */ }
  }

  // 4. Try by filename (most forgiving - handles full redirects to CDNs)
  if (filename) {
    const cleanName = filename.split(/[/\\]/).pop();
    if (cleanName) {
      hash = sniffedHashes.get("__filename__" + cleanName);
      if (hash) return hash;
    }
  }

  // 5. Try by referrer
  if (referrer) {
    hash = sniffedHashes.get(referrer);
    if (hash) return hash;
    
    // Check origin+path of referrer
    try {
      const parsed = new URL(referrer);
      hash = sniffedHashes.get(parsed.origin + parsed.pathname);
      if (hash) return hash;
    } catch { /* ignore */ }
  }

  return null;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "HASH_FOUND" && message.url && message.checksum) {
    storeHash(message.url, message.checksum);
  }
});

async function sendToPDM(endpoint, payload) {
  for (let port = 6801; port <= 6810; port++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        return true;
      }
    } catch {
      // Ignore and try the next port
    }
  }
  return false;
}

function isSupportedDownloadUrl(url) {
  if (!url || typeof url !== "string") return false;
  return /^(https?|ftp):\/\//i.test(url.trim());
}

async function handleDownloadInterception(downloadItem, suggestCallback) {
  if (typeof suggestCallback === "function") {
    try {
      suggestCallback();
    } catch {
      // ignore
    }
  }

  if (!downloadItem || !isSupportedDownloadUrl(downloadItem.url)) {
    return;
  }

  try {
    let cookieString = "";
    try {
      let cookies = await chrome.cookies.getAll({ url: downloadItem.url });
      if (!cookies || cookies.length === 0) {
        const urlObj = new URL(downloadItem.url);
        cookies = await chrome.cookies.getAll({ domain: urlObj.hostname });
      }
      if (cookies && cookies.length > 0) {
        cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      }
    } catch (e) {
      console.warn("Failed to retrieve cookies for download:", e);
    }

    const cleanFilename = downloadItem.filename ? downloadItem.filename.split(/[/\\]/).pop() : "";
    const matchedHash = lookupHash(downloadItem.url, downloadItem.finalUrl, cleanFilename, downloadItem.referrer);

    const payload = {
      url: downloadItem.url,
      referrer: downloadItem.referrer || "",
      cookies: cookieString,
      userAgent: navigator.userAgent,
      filename: cleanFilename,
      fileSize: downloadItem.fileSize || 0,
      checksum: matchedHash || undefined
    };

    const success = await sendToPDM("/download", payload);
    if (!success) {
      console.error("Failed to connect to PDM API on any port (6801-6810).");
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Purrfect Download Manager",
        message: "Failed to send download to PDM. Make sure the app is running!"
      });
    }
  } catch (err) {
    console.error("Error handling download interception:", err);
  }
}

if (chrome.downloads?.onDeterminingFilename) {
  // Chromium engine (Chrome, Brave, Edge, Opera)
  chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
    if (downloadItem.state !== "in_progress" || !pdmEnabled || !isSupportedDownloadUrl(downloadItem.url)) {
      suggest();
      return;
    }
    chrome.downloads.cancel(downloadItem.id, async () => {
      if (chrome.runtime.lastError) { /* ignore cancel failure */ }
      suggest();
      await handleDownloadInterception(downloadItem);
    });
    return true;
  });
} else if (chrome.downloads?.onCreated) {
  // Gecko engine (Mozilla Firefox)
  chrome.downloads.onCreated.addListener(async (downloadItem) => {
    if (!pdmEnabled || (downloadItem.state && downloadItem.state !== "in_progress") || !isSupportedDownloadUrl(downloadItem.url)) {
      return;
    }
    // Cancel native browser download and erase from Firefox download manager history
    try {
      await chrome.downloads.cancel(downloadItem.id);
      await chrome.downloads.erase({ id: downloadItem.id });
    } catch (e) {
      console.warn("Could not cancel/erase Firefox download:", e);
    }
    await handleDownloadInterception(downloadItem);
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  // Default to enabled on install
  if (details.reason === "install") {
    chrome.storage.local.set({ pdm_enabled: true });
  }

  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) { /* ignore */ }
    chrome.contextMenus.create({
      id: "pdm-download",
      title: "Download with Purrfect Download Manager",
      contexts: ["link", "image", "video", "audio"]
    }, () => {
      if (chrome.runtime.lastError) { /* ignore */ }
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "pdm-download") {
    const targetUrl = info.linkUrl || info.srcUrl || info.pageUrl;
    if (!targetUrl || !isSupportedDownloadUrl(targetUrl)) return;

    let cookieString = "";
    try {
      let cookies = await chrome.cookies.getAll({ url: targetUrl });
      if (!cookies || cookies.length === 0) {
        const urlObj = new URL(targetUrl);
        cookies = await chrome.cookies.getAll({ domain: urlObj.hostname });
      }
      if (cookies && cookies.length > 0) {
        cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      }
    } catch (e) {
      console.warn("Failed to retrieve cookies for context menu download:", e);
    }

    const matchedHash = lookupHash(targetUrl, null, null);

    const payload = {
      url: targetUrl,
      referrer: tab?.url || "",
      cookies: cookieString,
      userAgent: navigator.userAgent,
      filename: "",
      fileSize: 0,
      checksum: matchedHash || undefined
    };

    const success = await sendToPDM("/download", payload);
    if (!success) {
      console.error("Failed to connect to PDM API on any port (6801-6810).");
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Purrfect Download Manager",
        message: "Failed to send download to PDM. Make sure the app is running!"
      });
    }
  }
});
