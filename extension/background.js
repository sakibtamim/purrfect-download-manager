chrome.downloads.onCreated.addListener(async (downloadItem) => {
  // If we already sent it, or it's not interceptable, ignore.
  if (downloadItem.state !== "in_progress") return;

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

    try {
      // Send the payload to PDM's hidden local API
      const response = await fetch("http://localhost:6801/download", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        console.error("PDM is not running or rejected the request.", response.statusText);
      }
    } catch (e) {
      console.error("Failed to connect to PDM API on port 6801.", e);
    }
  });
});
