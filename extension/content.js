// content.js - Purrfect Download Manager Hash Sniffer
// Strategy: Both proactive page scanning AND click-time detection

const HASH_REGEX = /(?:md5|sha[\-\s]?1|sha[\-\s]?224|sha[\-\s]?256|sha[\-\s]?384|sha[\-\s]?512|checksum|hash|digest)[\s\:\=\-]+([a-fA-F0-9]{32,128})\b/gi;
const RAW_HASH_REGEX = /\b([a-fA-F0-9]{64})\b/g; // SHA-256 is the most common standalone hash

/**
 * Scan an element's text content for hash-like strings.
 * Returns the first match found, or null.
 */
function findHashInText(text) {
  if (!text || text.length < 32) return null;

  // Try labeled hash first (e.g. "sha256:abc123..." or "SHA-256 = abc...")
  HASH_REGEX.lastIndex = 0;
  const labeled = HASH_REGEX.exec(text);
  if (labeled && labeled[1]) return labeled[1].toLowerCase();

  // Try raw 64-char hex (SHA-256 is the most common unlabeled hash)
  RAW_HASH_REGEX.lastIndex = 0;
  const raw = RAW_HASH_REGEX.exec(text);
  if (raw && raw[1]) return raw[1].toLowerCase();

  return null;
}

/**
 * Given a clickable element, search progressively wider scopes for a hash.
 */
function findHashNearElement(el) {
  const scopes = [
    el,                          // The element itself
    el.parentElement,            // Immediate parent (e.g. a <td>)
    el.closest('tr'),            // Table row (GitHub Actions, download tables)
    el.closest('li'),            // List item
    el.closest('[class*="card"]'), // Card-style containers
    el.closest('[class*="item"]'), // Generic item containers
    el.closest('[class*="row"]'),  // Row containers
  ];

  // Also walk up to 4 ancestor levels for unusual layouts
  let ancestor = el.parentElement;
  for (let i = 0; i < 4 && ancestor; i++) {
    scopes.push(ancestor);
    ancestor = ancestor.parentElement;
  }

  for (const scope of scopes) {
    if (!scope) continue;
    const hash = findHashInText(scope.textContent);
    if (hash) return hash;
  }
  return null;
}

/**
 * Proactive page scan: find all links near hashes and send them to the background.
 * Runs once on page load and periodically for SPAs.
 */
function scanPageForHashes() {
  // Strategy 1: Scan all table rows that contain both a link and hash text
  document.querySelectorAll('tr').forEach(row => {
    const link = row.querySelector('a[href]');
    if (!link) return;
    const hash = findHashInText(row.textContent);
    if (hash) {
      sendHash(link.href, hash);
    }
  });

  // Strategy 2: Scan list items
  document.querySelectorAll('li').forEach(li => {
    const link = li.querySelector('a[href]');
    if (!link) return;
    const hash = findHashInText(li.textContent);
    if (hash) {
      sendHash(link.href, hash);
    }
  });

  // Strategy 3: Scan any element that looks like a download card/item
  document.querySelectorAll('[class*="download"], [class*="artifact"], [class*="release"], [class*="asset"]').forEach(container => {
    const link = container.querySelector('a[href]');
    if (!link) return;
    const hash = findHashInText(container.textContent);
    if (hash) {
      sendHash(link.href, hash);
    }
  });
}

function sendHash(url, hash) {
  try {
    chrome.runtime.sendMessage({
      type: "HASH_FOUND",
      url: url,
      hash: hash
    });
  } catch (_) {
    // Extension context may be invalidated
  }
}

// --- Click-time detection (catches dynamic/SPA pages) ---
document.addEventListener('click', (event) => {
  // Find the closest clickable element (link OR button)
  const link = event.target.closest('a[href]');
  const button = event.target.closest('button');
  const clickable = link || button;
  if (!clickable) return;

  const hash = findHashNearElement(clickable);
  if (!hash) return;

  // For <a> tags, use the href directly
  if (link && link.href) {
    sendHash(link.href, hash);
    return;
  }

  // For buttons, we don't have a URL yet. Store the hash keyed to the page URL
  // so the background script can match it as a fallback.
  sendHash(window.location.href, hash);
}, true);

// --- Proactive scanning ---
// Scan once the page is loaded
scanPageForHashes();

// Re-scan after a delay for SPAs that load content dynamically
setTimeout(scanPageForHashes, 3000);

// Watch for major DOM changes (new content loaded) and re-scan
let scanTimeout = null;
const observer = new MutationObserver(() => {
  if (scanTimeout) clearTimeout(scanTimeout);
  scanTimeout = setTimeout(scanPageForHashes, 1000);
});
observer.observe(document.body, { childList: true, subtree: true });
