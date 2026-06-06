// content.js - Purrfect Download Manager Sniffer

document.addEventListener('click', (event) => {
  // Find the closest anchor tag that was clicked
  const link = event.target.closest('a');
  if (!link || !link.href) return;

  // We want to look for text that resembles a hash
  // Typical hash lengths: MD5(32), SHA-1(40), SHA-224(56), SHA-256(64), SHA-384(96), SHA-512(128)
  const hashRegex = /(?:md5|sha[\-\s]?1|sha[\-\s]?256|sha[\-\s]?512|checksum|hash)[\s\:\=\-]*([a-fA-F0-9]{32,128})\b/i;
  
  // Also look for just raw hex strings of exact common lengths if they stand out
  const rawHashRegex = /\b([a-fA-F0-9]{32}|[a-fA-F0-9]{40}|[a-fA-F0-9]{56}|[a-fA-F0-9]{64}|[a-fA-F0-9]{96}|[a-fA-F0-9]{128})\b/i;

  let foundHash = null;

  // 1. Check the link's own text or title
  let textToSearch = link.textContent + " " + (link.title || "");
  
  // 2. Check the parent element (often hashes are right next to the link)
  if (link.parentElement) {
    textToSearch += " " + link.parentElement.textContent;
  }

  // First try the explicit labeled regex
  let match = textToSearch.match(hashRegex);
  if (match && match[1]) {
    foundHash = match[1];
  } else {
    // If no label, just look for a raw hash string
    match = textToSearch.match(rawHashRegex);
    if (match && match[1]) {
      foundHash = match[1];
    }
  }

  if (foundHash) {
    try {
      chrome.runtime.sendMessage({
        type: "HASH_FOUND",
        url: link.href,
        hash: foundHash.toLowerCase()
      });
    } catch (e) {
      // Extension context might be invalid
    }
  }
}, true); // Use capture phase to ensure we see it before default action
