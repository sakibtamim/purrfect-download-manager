document.addEventListener("DOMContentLoaded", async () => {
  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");
  const toggleSwitch = document.getElementById("intercept-toggle");
  const openAppBtn = document.getElementById("open-app-btn");

  // Load current toggle state
  const data = await chrome.storage.local.get("pdm_enabled");
  // Default to true if not set
  toggleSwitch.checked = data.pdm_enabled !== false;

  // Handle toggle changes
  toggleSwitch.addEventListener("change", (e) => {
    chrome.storage.local.set({ pdm_enabled: e.target.checked });
  });

  // Handle open app button
  openAppBtn.addEventListener("click", async () => {
    for (let port = 6801; port <= 6810; port++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/show`, { method: "GET" });
        if (res.ok) break;
      } catch {
        // Ignore if it's not running
      }
    }
    window.close();
  });

  // Check connection to PDM
  async function checkHealth() {
    let isConnected = false;
    for (let port = 6801; port <= 6810; port++) {
      let timeoutId;
      try {
        // AbortController to timeout quickly if not running
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), 200);

        const res = await fetch(`http://127.0.0.1:${port}/health`, { 
          method: "GET",
          signal: controller.signal
        });

        if (res.ok) {
          isConnected = true;
          break;
        }
      } catch {
        // continue to next port
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    }

    if (isConnected) {
      statusDot.className = "status-indicator online";
      statusText.innerText = "Connected to PDM";
      statusText.style.color = "#22c55e";
    } else {
      statusDot.className = "status-indicator offline";
      statusText.innerText = "PDM is Offline";
      statusText.style.color = "#ef4444";
    }
  }

  // Initial check
  checkHealth();

  // Poll every 3 seconds while popup is open
  setInterval(checkHealth, 3000);
});
