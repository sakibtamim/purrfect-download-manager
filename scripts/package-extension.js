const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const EXTENSION_DIR = path.resolve(__dirname, '../extension');
const DIST_DIR = path.resolve(__dirname, '../dist');

// Standard IEEE 802.3 CRC-32 lookup table
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosTimeDate(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((year - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { dosTime, dosDate };
}

function createZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const rawBuf = entry.data;
    const checksum = crc32(rawBuf);
    const deflated = zlib.deflateRawSync(rawBuf);
    const useDeflate = deflated.length < rawBuf.length;
    const compressedBuf = useDeflate ? deflated : rawBuf;
    const method = useDeflate ? 8 : 0;
    const { dosTime, dosDate } = toDosTimeDate(entry.mtime || new Date());

    // Local file header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed to extract (2.0)
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressedBuf.length, 18);
    localHeader.writeUInt32LE(rawBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    localParts.push(localHeader, nameBuf, compressedBuf);

    // Central directory header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE((3 << 8) | 20, 4); // Unix creator + 2.0
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressedBuf.length, 20);
    centralHeader.writeUInt32LE(rawBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42); // relative offset

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressedBuf.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

function collectExtensionFiles(dir, baseDir = dir) {
  const results = [];
  const items = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));

  for (const item of items) {
    if (item.name === '.DS_Store' || item.name === 'Thumbs.db') continue;
    const fullPath = path.join(dir, item.name);
    const relPath = path.relative(baseDir, fullPath).split(path.sep).join('/');

    if (item.isDirectory()) {
      results.push(...collectExtensionFiles(fullPath, baseDir));
    } else if (item.isFile() && relPath !== 'manifest.json') {
      const stat = fs.statSync(fullPath);
      results.push({
        name: relPath,
        data: fs.readFileSync(fullPath),
        mtime: stat.mtime,
      });
    }
  }

  return results;
}

function buildTargetManifest(baseManifest, target) {
  const manifest = JSON.parse(JSON.stringify(baseManifest));

  if (target === 'chrome') {
    if (manifest.background && typeof manifest.background === 'object') {
      delete manifest.background.scripts;
    }
    if (manifest.browser_specific_settings && typeof manifest.browser_specific_settings === 'object') {
      delete manifest.browser_specific_settings.gecko;
      if (Object.keys(manifest.browser_specific_settings).length === 0) {
        delete manifest.browser_specific_settings;
      }
    }
  } else if (target === 'firefox') {
    if (manifest.background && typeof manifest.background === 'object') {
      delete manifest.background.service_worker;
    }
  } else {
    throw new Error(`Unsupported extension target: ${target}`);
  }

  return Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

function packageExtension(extensionDir = EXTENSION_DIR, distDir = DIST_DIR) {
  const manifestPath = path.join(extensionDir, 'manifest.json');
  const baseManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const version = typeof baseManifest.version === 'string' ? baseManifest.version.trim() : '';

  if (!version) {
    throw new Error('extension/manifest.json is missing a valid "version" field.');
  }

  fs.mkdirSync(distDir, { recursive: true });
  const assetEntries = collectExtensionFiles(extensionDir);
  const manifestMtime = fs.statSync(manifestPath).mtime;
  const outputs = [];

  for (const target of ['chrome', 'firefox']) {
    const manifestEntry = {
      name: 'manifest.json',
      data: buildTargetManifest(baseManifest, target),
      mtime: manifestMtime,
    };
    const entries = [manifestEntry, ...assetEntries];
    const zipBuffer = createZipBuffer(entries);
    const outFile = path.join(distDir, `pdm-extension-${target}-v${version}.zip`);
    fs.writeFileSync(outFile, zipBuffer);
    outputs.push(outFile);
    console.log(`[package-extension] Built ${path.relative(process.cwd(), outFile)} (${entries.length} files, ${zipBuffer.length} bytes)`);
  }

  return outputs;
}

if (require.main === module) { // agyis: no-mutant CLI entrypoint guard
  packageExtension(); // agyis: no-mutant CLI entrypoint guard
}

module.exports = {
  buildTargetManifest,
  collectExtensionFiles,
  createZipBuffer,
  packageExtension,
};
