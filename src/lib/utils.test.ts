import { describe, it, expect } from 'vitest';
import { getFileCategory, validateChecksum, formatChecksum, DetectedChecksum } from './utils';

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
