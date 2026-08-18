import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SecureFileStorageService } from './secure-file-storage.service';

// These files are photographs of people's ID books and firearm licences, so
// the two properties that matter are: the bytes on disk are NOT the bytes the
// user uploaded, and a key that has round-tripped through the database and a
// request can never be steered outside the storage root.

describe('SecureFileStorageService', () => {
  const ORIGINAL_SECRET = process.env.ID_HASH_SECRET;
  const ORIGINAL_DIR = process.env.SECURE_UPLOAD_DIR;
  let root: string;
  let svc: SecureFileStorageService;

  beforeEach(async () => {
    process.env.ID_HASH_SECRET = 'test-secret-for-secure-file-specs';
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'secure-files-'));
    process.env.SECURE_UPLOAD_DIR = root;
    svc = new SecureFileStorageService();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  afterAll(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.ID_HASH_SECRET;
    else process.env.ID_HASH_SECRET = ORIGINAL_SECRET;
    if (ORIGINAL_DIR === undefined) delete process.env.SECURE_UPLOAD_DIR;
    else process.env.SECURE_UPLOAD_DIR = ORIGINAL_DIR;
  });

  const WHEN = new Date('2026-08-18T10:00:00Z');
  const fakeScan = () => Buffer.from('%PDF-1.4 pretend licence scan \x00\x01\x02');

  it('round-trips a file', async () => {
    const plain = fakeScan();
    const stored = await svc.write('motivations', plain, WHEN);
    expect(await svc.read(stored.storageKey)).toEqual(plain);
    expect(stored.byteSize).toBe(plain.length);
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('writes CIPHERTEXT to disk — the plaintext never touches the filesystem', async () => {
    const plain = Buffer.from('ID number 8001015009087 and home address');
    const { storageKey } = await svc.write('motivations', plain, WHEN);
    const onDisk = await fs.readFile(path.join(root, storageKey));
    expect(onDisk).not.toEqual(plain);
    expect(onDisk.toString('latin1')).not.toContain('8001015009087');
    // IV + tag + at least a byte of ciphertext.
    expect(onDisk.length).toBeGreaterThan(plain.length);
  });

  it('shards by year and month and never reuses a name', async () => {
    const a = await svc.write('motivations', fakeScan(), WHEN);
    const b = await svc.write('motivations', fakeScan(), WHEN);
    expect(a.storageKey).toMatch(/^motivations\/2026\/08\/[0-9a-f]{32}\.enc$/);
    expect(a.storageKey).not.toBe(b.storageKey);
  });

  it('detects tampering rather than returning damaged bytes', async () => {
    const { storageKey } = await svc.write('motivations', fakeScan(), WHEN);
    const abs = path.join(root, storageKey);
    const buf = await fs.readFile(abs);
    buf[buf.length - 1] ^= 0x01;
    await fs.writeFile(abs, buf);
    await expect(svc.read(storageKey)).rejects.toThrow();
  });

  it('refuses path traversal in every shape', async () => {
    for (const evil of [
      '../../../../etc/passwd',
      'motivations/2026/08/../../../../etc/passwd.enc',
      '/etc/passwd',
      'motivations/2026/08/x.enc/../../../../../etc/passwd',
      'motivations\\2026\\08\\x.enc',
      'motivations/2026/08/x.txt',
      'other/2026/08/abcdef12.enc',
      '',
    ]) {
      await expect(svc.read(evil)).rejects.toThrow(/Invalid storage key/);
      await expect(svc.remove(evil)).rejects.toThrow(/Invalid storage key/);
    }
  });

  it('remove deletes the bytes and is idempotent', async () => {
    const { storageKey } = await svc.write('motivations', fakeScan(), WHEN);
    expect(await svc.exists(storageKey)).toBe(true);
    await svc.remove(storageKey);
    expect(await svc.exists(storageKey)).toBe(false);
    // POPIA erasure must survive being run twice.
    await expect(svc.remove(storageKey)).resolves.toBeUndefined();
  });

  it('refuses to store an empty file', async () => {
    await expect(
      svc.write('motivations', Buffer.alloc(0), WHEN),
    ).rejects.toThrow(/empty/i);
  });

  it('cannot decrypt after the secret rotates — documented, not a surprise', async () => {
    const { storageKey } = await svc.write('motivations', fakeScan(), WHEN);
    process.env.ID_HASH_SECRET = 'a-different-secret';
    await expect(svc.read(storageKey)).rejects.toThrow();
  });
});
