import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { encryptBuffer, decryptBuffer } from './blob-crypto';

// ────────────────────────────────────────────────────────────────────
// Encrypted file storage ON THIS SERVER. Operator decision 2026-08-18:
// identity documents — ID cards, firearm licences, competency certificates,
// previous motivations — stay on our own box.
//
// WHY NOT CLOUDINARY, THE EXISTING RAIL. Every upload in this codebase today
// (listing photos, KYC selfies, dealer verification, complaint photos) lands on
// a PUBLIC Cloudinary secure_url. There is no `type: 'private'`, no
// `access_mode`, no signed URL and no S3/R2 anywhere — ALLOUTDOOR-REPLATFORM.md
// already says the quiet part: "The URL is unguessable, which is obscurity, not
// access control." A photograph of someone's ID book on a guessable-by-nobody
// public URL is not good enough for POPIA, so these never go there.
//
// WHAT THIS GIVES US THAT CLOUDINARY CANNOT:
//   • encrypted at rest — the bytes on disk are AES-256-GCM ciphertext, so a
//     stolen disk image or a stray backup is not a pile of ID documents
//   • no public URL exists at all; the only way to read a file is through an
//     authenticated endpoint that checks ownership first
//   • deletion is real deletion — POPIA erasure removes the file, it does not
//     merely unlink a CDN reference
//
// WHERE. Outside the git checkout, deliberately: the app lives in
// /home/alloutdoor/app and deploys pull, rebuild and would eventually sweep
// anything inside it. Default is <home>/secure-uploads, overridable with
// SECURE_UPLOAD_DIR. Files are sharded by year/month so no directory grows
// unbounded.
//
// ⚠️ BACKUPS ARE NOW TWO THINGS. Until this module, everything worth keeping
// was in Postgres and a pg_dump was a complete backup. These files are not in
// the database. Any backup routine must cover both, and a database restored
// without the file tree will show upload rows whose bytes are gone.
//
// ⚠️ THE KEY IS ID_HASH_SECRET (via blob-crypto). Rotating it makes every
// stored file unreadable. Nothing here can recover them.
// ────────────────────────────────────────────────────────────────────

/** Sub-trees, so one caller can never read another's files by key alone. */
export type SecureFileNamespace = 'motivations';

const NAMESPACES: readonly SecureFileNamespace[] = ['motivations'];

/** A stored file's key is `<namespace>/<yyyy>/<mm>/<id>.enc`, nothing else. */
const KEY_PATTERN = /^[a-z]+\/\d{4}\/\d{2}\/[a-z0-9]{8,40}\.enc$/;

export interface StoredFile {
  /** Opaque key to persist on the owning row. Never a filesystem path. */
  storageKey: string;
  /** SHA-256 of the PLAINTEXT bytes — lets us spot the same document twice. */
  sha256: string;
  /** Plaintext size in bytes (what the user actually uploaded). */
  byteSize: number;
}

@Injectable()
export class SecureFileStorageService {
  private readonly logger = new Logger(SecureFileStorageService.name);
  private readonly root: string;

  constructor() {
    this.root =
      process.env.SECURE_UPLOAD_DIR?.trim() ||
      path.join(os.homedir(), 'secure-uploads');
  }

  /** Where files live, for boot logging and admin diagnostics. */
  get rootDir(): string {
    return this.root;
  }

  /**
   * Write bytes encrypted. Returns the key to store on the owning row.
   *
   * The caller supplies NO part of the path — the id is generated here — so a
   * malicious filename can never influence where the file lands.
   */
  async write(
    namespace: SecureFileNamespace,
    plain: Buffer,
    when: Date,
  ): Promise<StoredFile> {
    this.assertNamespace(namespace);
    if (!Buffer.isBuffer(plain) || plain.length === 0) {
      throw new Error('Refusing to store an empty file');
    }

    const yyyy = String(when.getUTCFullYear());
    const mm = String(when.getUTCMonth() + 1).padStart(2, '0');
    const id = crypto.randomBytes(16).toString('hex');
    const storageKey = `${namespace}/${yyyy}/${mm}/${id}.enc`;

    const abs = this.resolve(storageKey);
    await fs.mkdir(path.dirname(abs), { recursive: true, mode: 0o700 });
    // 0600: readable only by the service account that wrote it.
    await fs.writeFile(abs, encryptBuffer(plain), { mode: 0o600 });

    return {
      storageKey,
      sha256: crypto.createHash('sha256').update(plain).digest('hex'),
      byteSize: plain.length,
    };
  }

  /** Read and decrypt. Throws if the key is malformed, missing or tampered. */
  async read(storageKey: string): Promise<Buffer> {
    return decryptBuffer(await fs.readFile(this.resolve(storageKey)));
  }

  /**
   * Delete a stored file. Idempotent — a missing file is a no-op, because
   * erasure must be able to run twice without failing the second time.
   */
  async remove(storageKey: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(storageKey));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  /** True when the bytes are still on disk — for admin health, not for auth. */
  async exists(storageKey: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(storageKey));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Map a key to an absolute path, refusing anything that is not exactly our
   * own key shape.
   *
   * This is the path-traversal gate. A key is only ever produced by write(),
   * but it round-trips through the database and a request, so it is treated as
   * untrusted on the way back in: the pattern rejects "..", absolute paths,
   * backslashes and any extension but .enc, and the resolved path is then
   * re-checked to be inside the root. Belt and braces, because the failure mode
   * here is reading arbitrary files off the server.
   */
  private resolve(storageKey: string): string {
    if (typeof storageKey !== 'string' || !KEY_PATTERN.test(storageKey)) {
      throw new Error('Invalid storage key');
    }
    // The pattern alone allows ANY lowercase first segment, so a key naming a
    // namespace we do not own ("other/2026/08/….enc") would sail past it and
    // fail later as a confusing filesystem error. Check it explicitly — a
    // spec caught this.
    if (!NAMESPACES.includes(storageKey.split('/')[0] as SecureFileNamespace)) {
      throw new Error('Invalid storage key');
    }
    const abs = path.resolve(this.root, storageKey);
    const rootWithSep = path.resolve(this.root) + path.sep;
    if (!abs.startsWith(rootWithSep)) {
      throw new Error('Invalid storage key');
    }
    return abs;
  }

  private assertNamespace(ns: SecureFileNamespace): void {
    if (!NAMESPACES.includes(ns)) throw new Error('Unknown storage namespace');
  }
}
