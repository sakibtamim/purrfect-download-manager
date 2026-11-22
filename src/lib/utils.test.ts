import { describe, it, expect } from 'vitest';
import { getFileCategory, validateChecksum, formatChecksum, formatSpeed, decodeFilename, parseContentDispositionFilename, DetectedChecksum } from './utils';

describe('getFileCategory', () => {
  it('correctly categorizes software files', () => {
    expect(getFileCategory('app.deb')).toBe('software');
    expect(getFileCategory('setup.exe')).toBe('software');
    expect(getFileCategory('package.pkg')).toBe('software');
  });

  it('correctly categorizes media files', () => {
    expect(getFileCategory('video.mp4')).toBe('media');
    expect(getFileCategory('song.flac')).toBe('media');
    expect(getFileCategory('image.png')).toBe('media');
  });

  it('correctly categorizes document files', () => {
    expect(getFileCategory('document.pdf')).toBe('documents');
    expect(getFileCategory('notes.md')).toBe('documents');
  });

  it('correctly categorizes archive files', () => {
    expect(getFileCategory('archive.tar.gz')).toBe('archives');
    expect(getFileCategory('backup.7z')).toBe('archives');
    expect(getFileCategory('files.zip')).toBe('archives');
  });

  it('falls back to other for unknown extensions', () => {
    expect(getFileCategory('unknown.xyz')).toBe('other');
  });
});

describe('validateChecksum', () => {
  it('validates correct sha256 checksum', () => {
    const valid: DetectedChecksum = {
      algorithm: 'sha256',
      digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      source: 'manual',
    };
    expect(validateChecksum(valid)).toBe(true);
  });

  it('rejects checksum with invalid length or non-hex characters', () => {
    const invalidLen: DetectedChecksum = {
      algorithm: 'sha256',
      digest: 'tooshort',
      source: 'manual',
    };
    expect(validateChecksum(invalidLen)).toBe(false);

    const nonHex: DetectedChecksum = {
      algorithm: 'md5',
      digest: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
      source: 'manual',
    };
    expect(validateChecksum(nonHex)).toBe(false);
  });
});

describe('formatChecksum', () => {
  it('formats sha256 to aria2 format', () => {
    const valid: DetectedChecksum = {
      algorithm: 'sha256',
      digest: 'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855',
      source: 'manual',
    };
    expect(formatChecksum(valid)).toBe('sha-256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('returns undefined for invalid checksum object', () => {
    expect(formatChecksum(undefined)).toBeUndefined();
  });
});

describe('formatSpeed', () => {
  describe('MBps (binary byte scaling)', () => {
    it('handles zero, negative, or invalid speed', () => {
      expect(formatSpeed(0)).toBe('0 B/s');
      expect(formatSpeed(0, 'MBps')).toBe('0 B/s');
      expect(formatSpeed(-100)).toBe('0 B/s');
      expect(formatSpeed('0')).toBe('0 B/s');
      expect(formatSpeed('invalid')).toBe('0 B/s');
    });

    it('formats bytes per second correctly', () => {
      expect(formatSpeed(500)).toBe('500 B/s');
      expect(formatSpeed(1024)).toBe('1 KB/s');
      expect(formatSpeed(1536)).toBe('1.5 KB/s');
      expect(formatSpeed(1048576)).toBe('1 MB/s');
      expect(formatSpeed(13107200)).toBe('12.5 MB/s');
      expect(formatSpeed(1073741824)).toBe('1 GB/s');
    });

    it('supports string inputs', () => {
      expect(formatSpeed('1048576')).toBe('1 MB/s');
      expect(formatSpeed('13107200')).toBe('12.5 MB/s');
    });
  });

  describe('Mbps (decimal networking scaling)', () => {
    it('handles zero, negative, or invalid speed', () => {
      expect(formatSpeed(0, 'Mbps')).toBe('0 bps');
      expect(formatSpeed(-100, 'Mbps')).toBe('0 bps');
      expect(formatSpeed('0', 'Mbps')).toBe('0 bps');
      expect(formatSpeed('invalid', 'Mbps')).toBe('0 bps');
    });

    it('multiplies by 8 and applies decimal scaling', () => {
      // 50 bytes/s * 8 = 400 bps (< 1000)
      expect(formatSpeed(50, 'Mbps')).toBe('400 bps');

      // 125 bytes/s * 8 = 1000 bps = 1 Kbps
      expect(formatSpeed(125, 'Mbps')).toBe('1 Kbps');

      // 12,500 bytes/s * 8 = 100,000 bps = 100 Kbps
      expect(formatSpeed(12500, 'Mbps')).toBe('100 Kbps');

      // 125,000 bytes/s * 8 = 1,000,000 bps = 1 Mbps
      expect(formatSpeed(125000, 'Mbps')).toBe('1 Mbps');

      // 12,500,000 bytes/s * 8 = 100,000,000 bps = 100 Mbps (matches 100 Mbps Speedtest)
      expect(formatSpeed(12500000, 'Mbps')).toBe('100 Mbps');

      // 125,000,000 bytes/s * 8 = 1,000,000,000 bps = 1 Gbps
      expect(formatSpeed(125000000, 'Mbps')).toBe('1 Gbps');
    });

    it('supports string inputs in Mbps', () => {
      expect(formatSpeed('12500000', 'Mbps')).toBe('100 Mbps');
    });
  });
});

describe('decodeFilename', () => {
  it('decodes URL percent-encoded characters like %20, %28, %29', () => {
    const raw = 'Last%20Man%20in%20Tower%20%282026%29%201080p%20WEB-DL%20Hindi%20x264.mkv';
    expect(decodeFilename(raw)).toBe('Last Man in Tower (2026) 1080p WEB-DL Hindi x264.mkv');
  });

  it('strips leading directory paths from filenames', () => {
    expect(decodeFilename('/downloads/movies/My%20Video.mp4')).toBe('My Video.mp4');
    expect(decodeFilename('C:\\Users\\Downloads\\Archive%20File.zip')).toBe('Archive File.zip');
  });

  it('handles malformed percent encodings gracefully without throwing', () => {
    expect(decodeFilename('100%_pure_gold.zip')).toBe('100%_pure_gold.zip');
    expect(decodeFilename('broken%zzfile.bin')).toBe('broken%zzfile.bin');
  });

  it('returns fallback for empty or null input', () => {
    expect(decodeFilename('')).toBe('Unknown');
    expect(decodeFilename(null)).toBe('Unknown');
    expect(decodeFilename(undefined)).toBe('Unknown');
  });
});

describe('parseContentDispositionFilename', () => {
  it('extracts standard filename="..." parameter', () => {
    const header = 'attachment; filename="document%202026.pdf"';
    expect(parseContentDispositionFilename(header)).toBe('document 2026.pdf');
  });

  it('extracts RFC 5987 / RFC 6266 filename*=UTF-8\'\'... parameter', () => {
    const header = "attachment; filename*=UTF-8''Last%20Man%20in%20Tower%20%282026%29.mkv";
    expect(parseContentDispositionFilename(header)).toBe('Last Man in Tower (2026).mkv');
  });

  it('returns null for empty or non-filename headers', () => {
    expect(parseContentDispositionFilename(null)).toBeNull();
    expect(parseContentDispositionFilename('inline')).toBeNull();
  });
});

