// content.js - Purrfect Download Manager Hash Sniffer
// Strategy: Deterministic DOM matching, click-time detection, and proactive file scanning.

// Labeled hashes: e.g. "sha256:abc123" or "SHA-256 = abc..."
const LABELED_REGEX = /(md5|sha[\-\s]?1|sha[\-\s]?224|sha[\-\s]?256|sha[\-\s]?384|sha[\-\s]?512)[\s\:\=\-]+([a-fA-F0-9]{32,128})\b/gi;
// Raw hashes: fallback for unlabeled 64-char hex
const RAW_HEX_REGEX = /\b([a-fA-F0-9]{32,128})\b/g;

function normalizeAlgorithm(label) {
  const normalized = label.toLowerCase().replace(/[\s\-_]/g, '');
  const map = {
    "md5": "md5",
    "sha1": "sha1",
    "sha224": "sha224",
    "sha256": "sha256",
    "sha384": "sha384",
    "sha512": "sha512",
  };
  return map[normalized] || null;
}

function inferAlgorithmFromLength(length) {
  switch (length) {
    case 32: return "md5";
    case 40: return "sha1";
    case 56: return "sha224";
    case 64: return "sha256";
    case 96: return "sha384";
    case 128: return "sha512";
    default: return null;
  }
}

const STRENGTH_ORDER = ["sha512", "sha384", "sha256", "sha224", "sha1", "md5"];

function selectStrongest(hashes) {
  if (hashes.length === 0) return null;
  if (hashes.length === 1) return hashes[0];
  return hashes.sort((a, b) =>
    STRENGTH_ORDER.indexOf(a.algorithm) - STRENGTH_ORDER.indexOf(b.algorithm)
  )[0];
}

/**
 * Returns ALL hashes found in text, with labeled ones prioritized.
 */
function extractHashesFromText(text) {
  if (!text) return [];
  const results = [];

  // 1. Labeled
  LABELED_REGEX.lastIndex = 0;
  let match;
  while ((match = LABELED_REGEX.exec(text)) !== null) {
    const algo = normalizeAlgorithm(match[1]);
    if (algo && match[2].length === (algo === 'md5' ? 32 : algo === 'sha1' ? 40 : algo === 'sha224' ? 56 : algo === 'sha256' ? 64 : algo === 'sha384' ? 96 : 128)) {
      results.push({
        algorithm: algo,
        digest: match[2].toLowerCase(),
        source: "labeled"
      });
    }
  }

  // 2. Raw fallback (only if no labeled found)
  if (results.length === 0) {
    RAW_HEX_REGEX.lastIndex = 0;
    while ((match = RAW_HEX_REGEX.exec(text)) !== null) {
      const algo = inferAlgorithmFromLength(match[1].length);
      if (algo) {
        results.push({
          algorithm: algo,
          digest: match[1].toLowerCase(),
          source: "raw-length"
        });
      }
    }
  }

  return results;
}

function verifyFilenameAssociation(containerText, linkFilename) {
  if (!linkFilename) return true;
  return containerText.toLowerCase().includes(linkFilename.toLowerCase());
}

/**
 * Deterministic rules to find a checksum for a clicked link.
 */
function findChecksumForLink(link) {
  const linkFilename = link.href ? link.href.split('/').pop().split('?')[0] : null;

  // Rule 1: Same table row
  const row = link.closest('tr');
  if (row) {
    const hashes = extractHashesFromText(row.textContent);
    if (hashes.length > 0) return selectStrongest(hashes);
  }

  // Rule 2: Same list item
  const li = link.closest('li');
  if (li) {
    const hashes = extractHashesFromText(li.textContent);
    if (hashes.length > 0) return selectStrongest(hashes);
  }

  // Rule 3: Hash explicitly references filename in same semantic container
  const container = link.closest(
    '[class*="card"], [class*="artifact"], [class*="release"], ' +
    '[class*="asset"], [class*="download"], [class*="item"]'
  );
  if (container) {
    const hashes = extractHashesFromText(container.textContent);
    if (hashes.length === 1) return hashes[0]; // Only 1 hash in container, safe to use
    if (hashes.length > 1 && verifyFilenameAssociation(container.textContent, linkFilename)) {
        return selectStrongest(hashes);
    }
  }

  // Rule 4: No match. Don't guess wildly.
  return null;
}

function sendHash(url, checksum) {
  try {
    chrome.runtime.sendMessage({
      type: "HASH_FOUND",
      url: url,
      checksum: checksum // structured DetectedChecksum object
    });
  } catch (_) {
    // Extension context may be invalidated
  }
}

// --- Checksum File Parsing ---
const CHECKSUM_FILE_PATTERNS = [
  /SHA256SUMS$/i, /SHA512SUMS$/i, /CHECKSUMS$/i,
  /checksums\.txt$/i, /md5sums$/i, /\.sha256$/i, /\.sha512$/i, /\.md5$/i, /\.sha1$/i
];

async function fetchAndParseChecksumFile(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return;
    
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > 1024 * 1024) {
      return; // Skip files larger than 1MB to prevent memory exhaustion
    }
    
    const text = await response.text();
    const lines = text.trim().split('\n');
    
    // Guess algorithm from filename if possible
    const filenameMatch = url.match(/(sha1|sha256|sha512|md5)/i);
    const defaultAlgo = filenameMatch ? normalizeAlgorithm(filenameMatch[1]) : "sha256";

    // Infer target filename from the URL of the checksum file itself
    // e.g. "app.iso.sha256" -> "app.iso"
    let targetFilename = url.split('/').pop().split('?')[0];
    if (targetFilename && targetFilename.includes('.')) {
       targetFilename = targetFilename.replace(/\.(sha\d+|md5|sum|txt|sig)$/i, '');
    }

    lines.forEach(line => {
      // 1. Standard format: "hash *filename" or "hash  filename"
      let match = line.trim().match(/^([a-fA-F0-9]{32,128})\s+\*?(.+)$/);
      if (match) {
        const digest = match[1].toLowerCase();
        const filename = match[2].trim().split(/[/\\]/).pop();
        const algo = inferAlgorithmFromLength(digest.length) || defaultAlgo;
        if (algo) {
          sendHash("__filename__" + filename, {
            algorithm: algo,
            digest: digest,
            source: "checksum-file"
          });
        }
      } else {
        // 2. Raw hash format: just a hash on a line
        match = line.trim().match(/^([a-fA-F0-9]{32,128})$/);
        // Only use targetFilename if it's not a generic name like "SHA256SUMS"
        if (match && targetFilename && !/^(sha|md5|checksum)/i.test(targetFilename)) {
            const digest = match[1].toLowerCase();
            const algo = inferAlgorithmFromLength(digest.length) || defaultAlgo;
            if (algo) {
              sendHash("__filename__" + targetFilename, {
                algorithm: algo,
                digest: digest,
                source: "checksum-file"
              });
            }
        }
      }
    });
  } catch (e) {
    console.warn("Failed to fetch checksum file:", e);
  }
}

function scanForChecksumFiles() {
  document.querySelectorAll('a[href]').forEach(link => {
    const isChecksumFile = CHECKSUM_FILE_PATTERNS.some(p => p.test(link.href) || p.test(link.textContent));
    // Check if we haven't already fetched it
    if (isChecksumFile && !link.dataset.pdmChecksumFetched) {
      link.dataset.pdmChecksumFetched = "true";
      fetchAndParseChecksumFile(link.href);
    }
  });
}

// --- Global Page Scanning for Auto-Downloads ---
function scanPageForRawHashes() {
  const text = document.body.textContent;
  if (!text || text.length > 100000) return; // Avoid scanning extremely large pages to prevent UI freezes

  // Extract all hashes from the entire page text (includes hidden text via textContent)
  const allHashes = extractHashesFromText(text);
  if (allHashes.length === 0) return;

  // If there are very few unique hashes on the entire page, it's safe to assume
  // they are just different algorithms for the same file.
  // This allows background.js to use the referrer to catch auto-downloads!
  const uniqueDigests = new Set(allHashes.map(h => h.digest));
  if (uniqueDigests.size <= 3) {
    sendHash(window.location.href, selectStrongest(allHashes));
  }
}

// --- Click-time detection (catches dynamic/SPA pages) ---
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href]');
  const button = event.target.closest('button');
  const clickable = link || button;
  if (!clickable) return;

  const checksum = findChecksumForLink(clickable);
  if (!checksum) return;

  if (link && link.href) {
    sendHash(link.href, checksum);
    return;
  }

  sendHash(window.location.href, checksum);
}, true);

// --- Proactive scanning for Checksum files ---
scanForChecksumFiles();
scanPageForRawHashes();
setTimeout(() => { scanForChecksumFiles(); scanPageForRawHashes(); }, 3000);
let scanTimeout = null;
const observer = new MutationObserver(() => {
  if (scanTimeout) clearTimeout(scanTimeout);
  scanTimeout = setTimeout(scanForChecksumFiles, 1000);
});
observer.observe(document.body, { childList: true, subtree: true });
