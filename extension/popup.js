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
    try {
      await fetch("http://localhost:6801/show", { method: "GET" });
    } catch (e) {
      // Ignore if it's not running
    }
    window.close();
  });

  // Check connection to PDM
  async function checkHealth() {
    try {
      // AbortController to timeout quickly if not running
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000);

      const res = await fetch("http://localhost:6801/health", { 
        method: "GET",
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        statusDot.className = "status-indicator online";
        statusText.innerText = "Connected to PDM";
        statusText.style.color = "#22c55e";
      } else {
        throw new Error("Bad status");
      }
    } catch (err) {
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
