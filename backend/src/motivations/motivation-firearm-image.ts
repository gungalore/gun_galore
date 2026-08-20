import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';

// ────────────────────────────────────────────────────────────────────
// A PHOTOGRAPH OF THE FIREARM, HELD ON OUR OWN DISK.
//
// The design handoff puts a framed photograph of the firearm on the cover, and
// prefills it from a hotlink to somebody else's gallery. Operator, 2026-08-21:
// "download them to a repo on our server. Dont link to anywhere."
//
// That is the right call for a reason beyond preference. A hotlinked cover
// image is a document that changes when a stranger renames a file: the PDF is
// re-rendered on every download, so a dead URL does not degrade an old copy —
// it silently removes the photograph from every future copy of every
// motivation, including ones already filed. Assets we serve are assets we can
// still serve next year.
//
// ⚠️ NOT IN THE ENCRYPTED UPLOAD TREE. SecureFileStorageService exists for the
// applicant's own documents: ID copies, safe photographs, bank statements. It
// encrypts, and its contents are unreadable without ID_HASH_SECRET. A stock
// photograph of a CZ 75 is not applicant data, has no retention obligation and
// must survive a secret rotation — so it lives beside the fonts, in assets/.
//
// ⚠️ NOTHING HERE RUNS IN A REQUEST. Fetching happens in the background
// research pass, never at render time: an outbound HTTP call in the download
// path would put a stranger's server inside our 60-second nginx ceiling, and a
// slow one would turn "download my motivation" into a 504.
// ────────────────────────────────────────────────────────────────────

/** Where the images live, resolved the same defensive way as the fonts. */
function imageDirCandidates(): string[] {
  return [
    path.join(process.cwd(), 'assets', 'firearms'),
    path.join(process.cwd(), 'backend', 'assets', 'firearms'),
    path.join(__dirname, '..', '..', 'assets', 'firearms'),
    path.join(__dirname, '..', '..', '..', 'assets', 'firearms'),
  ];
}

/**
 * A stable filename for a firearm.
 *
 * ⚠️ MAKE AND MODEL ONLY — never the serial. Two applicants applying for the
 * same model share one photograph, which is the point: it is a picture of the
 * TYPE, not of their individual firearm. Putting a serial in the key would
 * store one identical image per applicant and turn a shared asset into a
 * per-person record with all the retention questions that brings.
 */
export function firearmImageKey(make: string, model: string): string | null {
  const slug = `${make} ${model}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug.length >= 3 ? slug : null;
}

export interface FirearmImage {
  /** Absolute path on disk, ready for doc.image(). */
  file: string;
  /** Where it came from, kept so a future audit can retrace it. */
  source: string;
}

@Injectable()
export class FirearmImageService {
  private readonly logger = new Logger(FirearmImageService.name);

  /** The directory, created on first use. */
  private dir(): string {
    for (const d of imageDirCandidates()) {
      if (fsSync.existsSync(d)) return d;
    }
    const first = imageDirCandidates()[0];
    fsSync.mkdirSync(first, { recursive: true });
    return first;
  }

  /**
   * The stored photograph for this make and model, if we hold one.
   *
   * Pure disk, no network — safe to call from the render path.
   */
  find(make: string, model: string): FirearmImage | null {
    const key = firearmImageKey(make, model);
    if (!key) return null;
    for (const ext of ['jpg', 'png']) {
      const file = path.join(this.dir(), `${key}.${ext}`);
      if (fsSync.existsSync(file)) {
        let source = '';
        try {
          source = fsSync.readFileSync(
            path.join(this.dir(), `${key}.source.txt`),
            'utf8',
          );
        } catch {
          /* provenance note is a courtesy, not a requirement */
        }
        return { file, source: source.trim() };
      }
    }
    return null;
  }

  /**
   * Fetch and store a photograph, if we do not already hold one.
   *
   * ⚠️ CALL THIS FROM THE BACKGROUND RESEARCH PASS ONLY. It makes an outbound
   * request; see the note at the top about the request path.
   *
   * Fail-soft in every direction: no result, a bad content type, a timeout, a
   * full disk — all of them return null and the cover simply renders without a
   * photograph. A missing picture is a slightly plainer document; a throw here
   * would be a motivation that never gets written.
   */
  async fetchAndStore(
    make: string,
    model: string,
    /** "rifle", "handgun", "shotgun" — used to broaden a failed search. */
    type?: string,
  ): Promise<FirearmImage | null> {
    const key = firearmImageKey(make, model);
    if (!key) return null;

    const existing = this.find(make, model);
    if (existing) return existing;

    // ⚠️ A LADDER, BECAUSE THE EXACT MODEL USUALLY MISSES. "CZ 75" is on
    // Commons; "Howa 1500" and "Beretta 686" are not, and neither is most of
    // what a South African applicant actually owns. Falling back to the make
    // and the type gives a photograph of the right family of firearm rather
    // than a blank frame — and the caption on the cover names the make and
    // model from the applicant's own answers either way, so the page never
    // claims the picture is of their specific firearm.
    const terms = [
      `${make} ${model}`.trim(),
      type ? `${make} ${type}`.trim() : '',
      make.trim(),
    ].filter((t) => t.length >= 3);

    for (const term of terms) {
      const hit = await this.search(term, key);
      if (hit) return hit;
    }
    return null;
  }

  /** One Commons search, stored if it yields something usable. */
  private async search(term: string, key: string): Promise<FirearmImage | null> {
    try {
      const api =
        'https://commons.wikimedia.org/w/api.php?action=query&generator=search' +
        `&gsrsearch=${encodeURIComponent(term)}&gsrnamespace=6&gsrlimit=5` +
        '&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=900&format=json';

      const res = await fetch(api, {
        signal: AbortSignal.timeout(20_000),
        headers: { 'User-Agent': 'AllOutdoor/1.0 (motivation cover image)' },
      });
      if (!res.ok) return null;

      const body = (await res.json()) as {
        query?: {
          pages?: Record<
            string,
            {
              title?: string;
              imageinfo?: {
                thumburl?: string;
                mime?: string;
                thumbwidth?: number;
                thumbheight?: number;
              }[];
            }
          >;
        };
      };

      const pages = Object.values(body.query?.pages ?? {});
      // ⚠️ JPEG OR PNG ONLY. pdfkit embeds nothing else, and an SVG or a TIFF
      // stored here would fail at render time — a long way from the code that
      // chose it, on somebody else's download.
      const pick = pages
        .map((p) => ({ title: p.title ?? '', info: p.imageinfo?.[0] }))
        .find(
          (p) =>
            p.info?.thumburl &&
            (p.info.mime === 'image/jpeg' || p.info.mime === 'image/png') &&
            // Landscape-ish: the cover slot is a wide frame, and a portrait
            // photograph letterboxes into it badly.
            (p.info.thumbwidth ?? 0) >= (p.info.thumbheight ?? 1),
        );
      if (!pick?.info?.thumburl) return null;

      const img = await fetch(pick.info.thumburl, {
        signal: AbortSignal.timeout(25_000),
        headers: { 'User-Agent': 'AllOutdoor/1.0 (motivation cover image)' },
      });
      if (!img.ok) return null;
      const bytes = Buffer.from(await img.arrayBuffer());
      // A few hundred bytes is an error page, not a photograph.
      if (bytes.length < 4_000) return null;

      const ext = pick.info.mime === 'image/png' ? 'png' : 'jpg';
      const dir = this.dir();
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, `${key}.${ext}`);
      await fs.writeFile(file, bytes);
      await fs.writeFile(
        path.join(dir, `${key}.source.txt`),
        `${pick.title}\n${pick.info.thumburl}\n`,
        'utf8',
      );

      this.logger.log(
        `Stored a cover photograph for ${term} (${bytes.length} bytes)`,
      );
      return { file, source: `${pick.title} ${pick.info.thumburl}` };
    } catch (e) {
      this.logger.warn(
        `Could not fetch a cover photograph for "${term}": ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
      return null;
    }
  }
}
