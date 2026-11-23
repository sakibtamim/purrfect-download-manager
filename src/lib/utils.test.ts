import { describe, it, expect } from 'vitest';
import { getFileCategory, validateChecksum, formatChecksum, formatSpeed, decodeFilename, parseContentDispositionFilename, formatDriveSpace, DetectedChecksum } from './utils';

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
  // agyis: no-smell (testing formatSpeed utility, not a React component)
  describe('MBps mode - binary byte scaling', () => {
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

  describe('Mbps mode - decimal networking scaling', () => {
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

      // # agyis: no-smell (bandwidth unit conversion calculation, not React component)
      // 12,500,000 bytes/s * 8 = 100,000,000 bps = 100 Mbps - matches 100 Mbps Speedtest
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
    // # agyis: no-smell (testing URL decoding with parentheses in filename, not a React component)
    const raw = 'Last%20Man%20in%20tower%20%282026%29%201080p%20WEB-DL%20Hindi%20x264.mkv';
    expect(decodeFilename(raw)).toBe('Last Man in tower (2026) 1080p WEB-DL Hindi x264.mkv');
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

  it('prevents path traversal via percent-encoded sequences and dot traversals', () => {
    expect(decodeFilename('..%2F..%2Fetc%2Fshadow')).toBe('shadow');
    expect(decodeFilename('..%5C..%5Cwindows%5Csystem32')).toBe('system32');
    expect(decodeFilename('....//secret.txt')).toBe('secret.txt');
    expect(decodeFilename('..')).toBe('Unknown');
    expect(decodeFilename('....')).toBe('Unknown');
    expect(decodeFilename('..//')).toBe('Unknown');
    expect(decodeFilename('....//')).toBe('Unknown');
    expect(decodeFilename('..%252F..%252Fetc%252Fshadow')).toBe('shadow');
    expect(decodeFilename('/etc/passwd/')).toBe('passwd');
    expect(decodeFilename('foo/bar/')).toBe('bar');
    expect(decodeFilename('///')).toBe('Unknown');
  });
});

describe('formatDriveSpace', () => {
  it('formats zero and negative bytes correctly', () => {
    expect(formatDriveSpace(0)).toBe('0 B free');
    expect(formatDriveSpace(-100)).toBe('0 B free');
  });

  it('formats gigabytes and terabytes properly', () => {
    expect(formatDriveSpace(971 * 1024 * 1024 * 1024)).toBe('971 GB free');
    expect(formatDriveSpace(896 * 1024 * 1024 * 1024)).toBe('896 GB free');
    expect(formatDriveSpace(210 * 1024 * 1024 * 1024)).toBe('210 GB free');
    expect(formatDriveSpace(186 * 1024 * 1024 * 1024)).toBe('186 GB free');
    expect(formatDriveSpace(2000 * 1024 * 1024 * 1024)).toBe('2.0 TB free');
  });
});

describe('parseContentDispositionFilename', () => {
  it('extracts standard filename="..." parameter', () => {
    const header = 'attachment; filename="document%202026.pdf"';
    expect(parseContentDispositionFilename(header)).toBe('document 2026.pdf');
  });

  it('extracts RFC 5987 / RFC 6266 filename*=UTF-8\'\'... parameter', () => {
    // # agyis: no-smell (RFC 5987 filename parsing with parentheses, not a React component)
    const header = "attachment; filename*=UTF-8''Last%20Man%20in%20tower%20%282026%29.mkv";
    expect(parseContentDispositionFilename(header)).toBe('Last Man in tower (2026).mkv');
  });

  it('returns null for empty or non-filename headers', () => {
    expect(parseContentDispositionFilename(null)).toBeNull();
    expect(parseContentDispositionFilename('inline')).toBeNull();
  });
});

