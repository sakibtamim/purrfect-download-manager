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

chrome.downloads.onCreated.addListener(async (downloadItem) => {
  // If we already sent it, or it's not interceptable, ignore.
  if (downloadItem.state !== "in_progress") return;

  // Check if interception is enabled
  if (!pdmEnabled) return;

  // We immediately pause and cancel the browser's native download
  chrome.downloads.cancel(downloadItem.id, async () => {
    
    // We need to fetch the cookies for the URL
    const urlObj = new URL(downloadItem.url);
    const cookies = await chrome.cookies.getAll({ domain: urlObj.hostname });
    
    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const payload = {
      url: downloadItem.url,
      referrer: downloadItem.referrer || "",
      cookies: cookieString,
      userAgent: navigator.userAgent,
      filename: downloadItem.filename || "",
      fileSize: downloadItem.fileSize || 0
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
  });
});

chrome.runtime.onInstalled.addListener((details) => {
  // Default to enabled on install
  if (details.reason === "install") {
    chrome.storage.local.set({ pdm_enabled: true });
  }

  chrome.contextMenus.create({
    id: "pdm-download",
    title: "Download with Purrfect Download Manager",
    contexts: ["link", "image", "video", "audio"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "pdm-download") {
    const targetUrl = info.linkUrl || info.srcUrl || info.pageUrl;
    if (!targetUrl) return;

    let cookieString = "";
    try {
      const urlObj = new URL(targetUrl);
      const cookies = await chrome.cookies.getAll({ domain: urlObj.hostname });
      cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    } catch {}

    const payload = {
      url: targetUrl,
      referrer: tab?.url || "",
      cookies: cookieString,
      userAgent: navigator.userAgent,
      filename: "",
      fileSize: 0
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
