# Privacy Policy — Purrfect Download Manager (PDM)

**Effective Date:** 2026-11-25  
**Applies To:** Purrfect Download Manager Desktop App & Companion Browser Extension

Purrfect Download Manager is a local-first desktop download manager and companion browser extension. We do **not** collect, sell, rent, log, or transmit your personal data, browsing history, cookies, or download activity to any external or third-party servers.

---

## 1. Local-Only Loopback Communication

All communication between the companion browser extension and the Purrfect Download Manager desktop application occurs strictly over the local loopback interface (`http://127.0.0.1`, ports `6801–6810`):

- **`GET /health`**: Polled locally by the extension popup to check whether the desktop app is running.
- **`GET /show`**: Triggered when clicking **Open PDM** in the extension popup to bring the local desktop window to focus.
- **`POST /download`**: Transfers metadata for an intercepted download or context-menu action to your local desktop app instance.

No data leaves your device via the extension.

---

## 2. Data Handled Locally

When download interception is enabled (or when you click **Download with Purrfect Download Manager** in the context menu), the extension reads and forwards the following metadata **only** to `127.0.0.1:6801–6810`:

- **Download URL & Referrer**: The target file URL and referring page URL so `aria2` can fetch the file.
- **Suggested Filename & File Size**: Used to pre-populate the download staging modal.
- **Cookies & User-Agent**: Cookies scoped strictly to the target download URL/hostname and your browser `User-Agent` string, forwarded solely so authenticated or session-protected downloads can succeed in `aria2`.
- **Detected Checksums**: The content script scans visited pages and linked checksum manifests (such as `SHA256SUMS` or `.sha256` files under 1 MB) for cryptographic digests (`md5`, `sha1`, `sha224`, `sha256`, `sha384`, `sha512`) to verify downloaded files locally. Matched hashes are cached in extension memory for up to 10 minutes and discarded automatically.

### Local Storage
- The extension stores only your interception toggle preference (`pdm_enabled`) in `chrome.storage.local`.

---

## 3. Loopback Origin & CSRF Security Enforcement

To prevent malicious websites from abusing the local API, the desktop application enforces strict HTTP `Origin` validation on its loopback listener:

- **Web Origins Blocked (`403 Forbidden`)**: Any request carrying an `http://` or `https://` `Origin` header is rejected on `/show` and `/download`, protecting against Cross-Site Request Forgery (CSRF) and unauthorized focus-stealing from web pages.
- **Verified Extension Origins Only**: `POST /download` and `OPTIONS` preflight requests from browser contexts are restricted strictly to verified extension origins (`chrome-extension://`, `moz-extension://`, and `safari-web-extension://`).
- **Payload Caps**: `POST /download` request bodies are capped at 1 MB to prevent memory exhaustion.

---

## 4. Permissions Rationale (Browser Extension)

- `downloads`: Intercepts browser downloads when enabled and hands them off to the local PDM app.
- `cookies`: Reads cookies scoped to the intercepted download URL/domain so authenticated downloads can complete.
- `storage`: Persists your local interception on/off toggle (`pdm_enabled`).
- `contextMenus`: Adds the **Download with Purrfect Download Manager** right-click action.
- `notifications`: Displays local status alerts if the desktop app is not reachable.
- `<all_urls>` / `http://127.0.0.1/*` / `http://localhost/*`: Enables checksum sniffing on download pages and local loopback communication with the desktop app.

---

## 5. Third-Party Services

- The companion browser extension makes **zero** requests to external analytics, telemetry, tracking, or advertising services.
- Optional features inside the desktop application (such as user-configured Google Safe Browsing checks or downloading media/files from URLs you explicitly submit) communicate only with the endpoints required to perform those user-requested actions.

---

## 6. Contact

For questions or security disclosures, please open an issue at:  
https://github.com/sakibtamim/purrfect-download-manager
