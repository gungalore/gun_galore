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

/**
 * ⚠️ WIKIMEDIA'S USER-AGENT POLICY WANTS A CONTACT, and enforces it.
 * "AllOutdoor/1.0 (motivation cover image)" earned a plain
 * "You are making too many requests to the API" during testing — Wikimedia
 * rate-limits generic agents hard. A contactable agent is both the polite
 * thing and the working thing.
 */
const WIKIMEDIA_UA =
  'AllOutdoorMotivations/1.0 (https://alloutdoor.co.za; support@alloutdoor.co.za)';

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

/**
 * Does a Commons file title plausibly show this make and model?
 *
 * ⚠️ THE GUARD THAT STOPS AN ASSAULT RIFLE APPEARING ON A HUNTING LICENCE
 * APPLICATION. Commons search is fuzzy and ranks by relevance to the whole
 * phrase, so "Howa 1500" surfaces every Howa product Commons holds. Requiring
 * the make AND the model designation to appear in the title is what turns a
 * relevance ranking into a fact about the picture.
 *
 * Compared on the alphanumerics only, INDEPENDENTLY rather than as one string:
 * a title reading "Howa Model 1500" is the firearm we asked for, and a rule
 * demanding the literal run "howa1500" would throw it away. Meanwhile "Type 89
 * Assault Rifle JGSDF" contains neither token and is refused, which is the
 * whole point.
 */
export function plausiblyShows(
  title: string,
  make: string,
  model: string,
): boolean {
  const flat = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  const t = flat(title);
  const m = flat(make);
  const d = flat(model);
  if (!t || !m || !d) return false;
  // A make can be written several ways ("Ceska Zbrojovka", "CZ"); any word of
  // it appearing is enough, provided the model designation is there too.
  const makeHit = make
    .split(/[^A-Za-z0-9]+/)
    .map(flat)
    .filter((w) => w.length >= 2)
    .some((w) => t.includes(w));
  return makeHit && t.includes(d);
}

/**
 * Words that make a photograph a poor choice for a licence application, even
 * when it genuinely shows the applicant's model.
 *
 * Not a safety filter — plausiblyShows already guarantees the right firearm.
 * This only breaks ties, so a service-rifle photograph still gets used when it
 * is the only one Commons holds.
 */
const AWKWARD =
  /\b(assault|sniper|military|army|navy|marine|police|swat|tactical|combat|war|soldier|troops)\b/i;

/** Lower is better. */
export function scoreTitle(title: string): number {
  const clean = title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '');
  // A short title is usually a plain product photograph; a long one is usually
  // a photograph of an event that happens to contain the firearm.
  return clean.length + (AWKWARD.test(clean) ? 200 : 0);
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

    // ⚠️ THE MAKE-ONLY FALLBACK IS GONE, AND IT WAS DANGEROUS.
    //
    // The first version of this fell back to searching the make alone, on the
    // reasoning that "a photograph of the right family of firearm beats a
    // blank frame". Testing it against real applicant data showed exactly what
    // that reasoning costs. A search for "Howa" returned, and this code
    // happily stored, a photograph of a TYPE 89 ASSAULT RIFLE — Howa builds it
    // for the Japan Ground Self-Defense Force, so it is a genuine Howa — filed
    // under the name of a bolt-action hunting rifle. It would have gone on the
    // cover of a licence application, captioned as the applicant's own
    // firearm, addressed to the Registrar. "Beretta" returned a photograph
    // from a hunting fair with no identifiable firearm in the caption at all.
    //
    // A wrong picture is far worse than no picture here. The cover caption
    // names the applicant's make and model; a page pairing that caption with a
    // military rifle misrepresents the firearm to the police on a document the
    // applicant signs. So the rule is now: the result must plausibly BE the
    // model named, or there is no photograph and the cover renders without one.
    //
    // The remaining ladder is two SEARCH PHRASINGS, not two levels of
    // precision — both results face the same acceptance test below.
    if (!model.trim()) return null;

    // ⚠️ intitle: FIRST, AND IT IS NOT A MICRO-OPTIMISATION. Commons' default
    // search ranks by relevance to the whole phrase, which for "CZ Shadow 2"
    // means Czech-language paintings and fractals — "CZ" matches Czech. A
    // plain search for "Howa 1500" ranked a Type 89 assault rifle first and
    // buried anything that might actually be a 1500. Restricting to titles
    // turns the query into the same question the acceptance test asks:
    // Mossberg 500 goes from nothing usable to thirteen candidates, and Howa
    // 1500 honestly returns zero, because Commons does not hold one.
    const terms = [
      `intitle:"${make} ${model}"`,
      // The make is not always adjacent to the model in a title — "SAKO TIKKA
      // T3 ..." puts the parent brand first.
      `intitle:"${model}" ${make}`,
      // Last resort, still guarded.
      `${make} ${model}`.trim(),
    ].filter((t) => t.length >= 3);

    for (const term of terms) {
      const hit = await this.search(term, key, make, model);
      if (hit) return hit;
    }
    return null;
  }

  /** One Commons search, stored if it yields something usable. */
  private async search(
    term: string,
    key: string,
    make: string,
    model: string,
  ): Promise<FirearmImage | null> {
    try {
      const api =
        'https://commons.wikimedia.org/w/api.php?action=query&generator=search' +
                // ⚠️ TWENTY CANDIDATES, NOT FIVE. The acceptance test below is strict
        // enough that a bad result cannot get through, so the only thing a
        // small result set buys is MISSES: "Howa 1500" ranked a Type 89 first
        // and the real thing, if Commons holds it, never made the shortlist.
        // With the guard in place, more candidates is strictly better.
        `&gsrsearch=${encodeURIComponent(term)}&gsrnamespace=6&gsrlimit=20` +
        '&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=900&format=json';

      const res = await fetch(api, {
        signal: AbortSignal.timeout(20_000),
        headers: { 'User-Agent': WIKIMEDIA_UA },
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
      // ⚠️ RANKED, NOT FIRST-PAST-THE-POST. Everything reaching this point is
      // already the right model; the ranking decides WHICH photograph of it.
      // That matters more than it sounds: the only Commons photographs of a
      // Tikka T3 include "SAKO TIKKA T3 TAC 7.62x51 Bolt Action Sniper Rifle
      // of Indian Navy MARCOS", which is genuinely the applicant's model and
      // still the wrong picture to put on a hunting licence application if a
      // plain one exists. So military and tactical qualifiers are PENALISED,
      // never excluded — if the only photograph of your rifle is a service
      // one, that is still your rifle.
      const pick = pages
        .map((p) => ({ title: p.title ?? '', info: p.imageinfo?.[0] }))
        .filter(
          (p) =>
            p.info?.thumburl &&
            (p.info.mime === 'image/jpeg' || p.info.mime === 'image/png') &&
            // Landscape-ish: the cover slot is a wide frame, and a portrait
            // photograph letterboxes into it badly. Not strictly wider than
            // tall — a square-ish photograph of the right firearm beats a
            // wide one of nothing.
            (p.info.thumbwidth ?? 0) >= (p.info.thumbheight ?? 1) * 0.8 &&
            // ⚠️ AND IT HAS TO BE THE RIGHT FIREARM. See the note above.
            plausiblyShows(p.title, make, model),
        )
        .sort((a, b) => scoreTitle(a.title) - scoreTitle(b.title))[0];
      if (!pick?.info?.thumburl) return null;

      const img = await fetch(pick.info.thumburl, {
        signal: AbortSignal.timeout(25_000),
        headers: { 'User-Agent': WIKIMEDIA_UA },
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
