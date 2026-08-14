// The ammunition ban.
//
// Platform policy: All Outdoor does not sell ammunition. Live / loaded
// ammunition may never be listed, sold or traded here, under any
// circumstances — it is a permanent prohibition, not a paperwork step.
//
// The PERMITTED reloading components are projectiles / bullets and brass
// cases, and those only (prisma/seed.ts creates exactly Rifle Bullets, Rifle
// Brass Cases, Handgun Bullets, Handgun Brass Cases; primers and propellant
// powder have no category at all). Reloading EQUIPMENT — presses, dies,
// scales, powder measures, powder funnels, priming tools — is ordinary
// hardware and stays welcome.
//
// ── HOW THIS FILE IS STRUCTURED, AND WHY ────────────────────────────────
// The previous version of this suite was a dozen hand-written describe
// blocks, and it was GREEN while seven separate bypasses were live in the
// guard — because it tested the strings its author thought of. It is now two
// explicit corpora, MUST_REJECT and MUST_PASS, each driven by one it.each
// against the real exported guard. Adding a case is adding one line to an
// array; there is nowhere for a new string to hide.
//
// Rules for editing this file:
//   • A string that a reviewer found passing goes in MUST_REJECT, verbatim.
//   • Every MUST_REJECT string is ALSO tested with ", no offers" appended.
//     That suffix — ordinary South African classified boilerplate — used to
//     turn the whole guard off, because a bare negation anywhere in the
//     sentence excused the match and commas are not sentence boundaries.
//   • Every MUST_PASS string is tested BOTH as a title and as a description,
//     because the guard reads them differently (a title is the product name).
//   • NEVER weaken a MUST_PASS expectation to make a fix easier. A blocked
//     honest seller is a real customer lost, and the ban message accuses them
//     of something they did not do. If a fix cannot separate two strings,
//     leave the guard permissive (Claude moderation is the backstop behind
//     it), move the string to MUST_PASS and say why in its `why`.
//
// Three write paths validate a listing and each one is a bypass on its own, so
// all three are exercised at the bottom of the file:
//   previewDraft() — the seller trusts "it passed review"
//   create()       — the obvious one
//   update()       — publish something innocent, rewrite it afterwards.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { BadRequestException } from '@nestjs/common';
import { FeeCalculator } from '../payments/fee.calculator';
import {
  ListingsService,
  findLiveAmmunitionTerm,
  findLiveAmmunitionListing,
  isLiveAmmunitionCategory,
  AMMUNITION_BAN_MESSAGE,
  RELOADING_SUPPLY_BAN_MESSAGE,
} from './listings.service';

// The guard reads a title differently from a description: a title is the
// PRODUCT NAME, so a bare count of rounds in it is the offer itself.
const asTitle = (text: string) =>
  findLiveAmmunitionTerm(text, { context: text, isTitle: true });
const asDescription = (text: string) =>
  findLiveAmmunitionTerm(text, { context: text, isTitle: false });

interface Case {
  title: string;
  description?: string;
  why: string;
}

// ═══════════════════════════════════════════════════════════════════════
// MUST_REJECT — live ammunition, primers and propellant. Every string here
// is an advert for something that may not be listed. A string that stops
// being rejected is a live bypass, not a flaky test.
// ═══════════════════════════════════════════════════════════════════════

const MUST_REJECT_CORE: Case[] = [
  // ── Classified boilerplate must not unlock the guard ─────────────────
  // All fifteen of these blocked WITHOUT the trailing phrase and passed
  // WITH it, because `excused()` accepted a bare negation token anywhere in
  // the sentence and a comma does not end a sentence.
  {
    title: '500rds 9mm Luger FMJ, R6 each, no offers',
    why: 'boilerplate: ", no offers" on a per-round-priced count',
  },
  {
    title: '500rds 9mm Luger FMJ, R6 each, not negotiable',
    why: 'boilerplate: ", not negotiable"',
  },
  {
    title: '500rds 9mm Luger FMJ, R6 each, no time wasters',
    why: 'boilerplate: ", no time wasters"',
  },
  {
    title: '500rds 9mm Luger FMJ, R6 each, no holds',
    why: 'boilerplate: ", no holds"',
  },
  {
    title: '500rds 9mm Luger FMJ, R6 each, cash only, no swops',
    why: 'boilerplate: ", cash only, no swops"',
  },
  {
    title: '500rds 9mm Luger FMJ, R6 each, no delivery',
    why: 'boilerplate: ", no delivery"',
  },
  {
    title: '500rds 9mm Luger FMJ, R6 each, no cheques',
    why: 'boilerplate: ", no cheques"',
  },
  {
    title: '500rds 9mm Luger FMJ, R6 each, price is not negotiable',
    why: 'boilerplate: ", price is not negotiable"',
  },
  {
    title: '500rds 9mm Luger FMJ, R6 each, no couriers',
    why: 'boilerplate: ", no couriers"',
  },
  {
    title: '500 rounds .223 Rem for sale, no holds',
    why: 'boilerplate on a for-sale count',
  },
  {
    title: '1000 rounds of 9mm in original factory boxes, R6500, no offers',
    why: 'boilerplate on the packaging-laundered phrasing',
  },
  {
    title: 'Bulk 5.56 - 1000 available, R9 each, no time wasters',
    why: 'boilerplate on the count+calibre profile',
  },
  {
    title: '9mm Luger 115gr FMJ - box of 50, R450 per box, not negotiable',
    why: 'boilerplate on the box-of profile',
  },
  {
    title: '1000 CCI small rifle primers for sale, R900, no offers',
    why: 'boilerplate re-opened PRIMERS too — separate prohibition',
  },
  {
    title: '500g Varget powder, R700, no swops',
    why: 'boilerplate re-opened PROPELLANT too — separate prohibition',
  },

  // ── A price is a supply signal, at any number of digits ──────────────
  // SUPPLY_MARKER's price alternative sat inside a group closed by \b, so it
  // only ever matched a ONE-DIGIT price: 'R450' tested false. "9mm ammo R6"
  // blocked while "9mm ammo R450" walked.
  { title: '9mm ammo R450', why: 'priced ammo, multi-digit price' },
  { title: '9mm ammo R450 a box', why: 'priced-per-box ammo' },
  { title: '9mm ammo R6', why: 'priced ammo, single-digit price (regression)' },
  {
    title: 'Clearing out the gun safe',
    description: '9mm ammo R450',
    why: 'multi-digit price in a DESCRIPTION — the isTitle exemption cannot help here',
  },
  {
    title: 'Clearing out the gun safe',
    description: '9mm ammo R450 a box',
    why: 'per-box price in a description',
  },

  // ── "ammo" in a TITLE is the product name ────────────────────────────
  // Rule 3 exempted a title for "ammunition"; Rule 4 did not for "ammo", so
  // the title "Ammunition" blocked and "9mm ammo" did not.
  {
    title: '9mm ammo',
    why: 'nobody titles a listing "ammo" except to sell it',
  },
  { title: 'Ammo 9mm Luger', why: 'ammo as the product name' },
  { title: 'Ammo - 9mm Luger 115gr', why: 'ammo as the product name' },
  { title: '.223 ammo, collection only', why: 'ammo as the product name' },
  { title: 'Ammunition', why: 'the spelled-out product name (regression)' },

  // ── Wear vocabulary must not veto a priced or for-sale count ─────────
  // WEAR_CONTEXT ended in a bare \btotal\b, and wear both short-circuited
  // the sale-signal branch and hard-gated Rule 6 off.
  {
    title: '1000 rounds .223 Rem for sale, 4 boxes total',
    why: '"total" is not wear copy',
  },
  {
    title: 'PMP 9mm 115gr FMJ x 250, R1500 total',
    why: '"total" must not switch off the loaded-round profile',
  },
  {
    title: '500 rounds 9mm for sale, all in mint condition',
    why: 'a condition phrase elsewhere must not veto a for-sale count',
  },

  // ── One component/carrier noun must not launder a priced advert ──────
  {
    title: '500 rounds 9mm, in ammo pouch, R6 each',
    why: 'carrier noun laundering a per-round price',
  },
  {
    title: '1000 rounds 5.56, comes in ammo can, R9 each',
    why: 'carrier noun laundering a per-round price',
  },
  {
    title: '500 rounds 9mm FMJ',
    description: 'Copper plated bullets in new brass cases. R6 each.',
    why: 'component nouns in the sibling field laundering a per-round price',
  },

  // ── A throw-in must not switch the loaded-round profile off ──────────
  {
    title: 'PMP 9mm 115gr x 500, R6 each',
    description: 'Free rifle bag thrown in.',
    why: 'PRODUCT_CONTEXT includes bags — a throw-in cannot veto a priced advert',
  },
  {
    title: 'Bulk 5.56 62gr x 1000, R9 each',
    description: 'Rifle sling thrown in for free.',
    why: 'same, via a different throw-in product',
  },

  // ── Quantity vocabulary is not a closed list ─────────────────────────
  { title: '1000 shots 9mm for sale, R6500', why: '"shots" as the counter' },
  {
    title: '9mm Luger, 1000 skote te koop, R6500',
    why: 'Afrikaans "skote" as the counter',
  },
  {
    title: '9mm Luger, 500 stuks, R6 elk',
    why: 'generic counter with the calibre one comma away',
  },
  { title: '1k rounds 9mm Luger, R6500', why: 'k multiplier, lowercase' },
  { title: '1K rds .223, R6500', why: 'K multiplier on the "rds" counter' },
  {
    title: 'Five hundred rounds of 9mm, R6 each',
    why: 'spelled-out count',
  },
  {
    title: '1.000 rounds 9mm te koop',
    why: 'full stop as the thousands separator (used to parse as qty 0)',
  },
  {
    title: '20 boxes of 9mm, R450 a box',
    why: 'the count is of BOXES, not rounds — no rule fired',
  },
  {
    title: '10 x 50rd boxes 9mm, R4500',
    why: 'singular "rd" with no word boundary after the digits',
  },

  // ── Quantity nouns the original pattern omitted ──────────────────────
  { title: '500rds 9mm FMJ, R6 each', why: 'rds + calibre + per-unit price' },
  { title: '500 rds .223 Rem for sale', why: 'rds spaced + for sale' },
  { title: '1000rds CCI Mini Mag', why: 'rds + ammunition brand' },
  { title: '500 rnds 9mm for sale, R6 each', why: 'rnds' },
  { title: '500 pcs 9mm available, R6 each', why: 'pcs bound to a calibre' },
  { title: '500 stuks 9mm te koop, R6 elk', why: 'stuks bound to a calibre' },
  { title: '250 rnd .308 for sale', why: 'rnd singular bound to a calibre' },

  // ── Count + calibre with NO ammunition noun at all ───────────────────
  {
    title: '9mm Luger 115gr FMJ - box of 50, R450 per box',
    why: 'box-of phrasing',
  },
  { title: 'PMP 9mm 115gr FMJ x 250, R1500', why: 'x-count phrasing' },
  { title: '.308 Win 150gr SP - 100 for sale', why: 'bare count + for sale' },
  {
    title: 'Bulk 5.56 - 1000 available, R9 each',
    why: 'bulk + per-unit price',
  },
  { title: 'Factory fresh 9mm, sealed 50s, R450 a box', why: 'sealed 50s' },

  // ── Naming the packaging must not launder the offer ──────────────────
  {
    title: '1000 rounds of 9mm in original factory boxes, R6500',
    why: 'original factory boxes',
  },
  { title: 'Case of 500 rounds .223 Remington, sealed', why: 'case of' },
  { title: '200 rounds 9mm boxed and sealed', why: 'boxed and sealed' },
  { title: '50 live rounds in a box, R400', why: 'live rounds in a box' },
  {
    title: 'Range clear-out',
    description: '1000 rounds of 9mm in original factory boxes, R6500.',
    why: 'the same phrasing sitting in the description',
  },

  // ── Afrikaans and obfuscation ────────────────────────────────────────
  { title: 'Ammunisie te koop, R6 elk', why: 'ammunisie for sale' },
  { title: '500 patrone 9mm te koop, R6 elk', why: 'patrone by count' },
  { title: 'Lewendige patrone beskikbaar', why: 'lewendige patrone' },
  { title: 'Gelaaide doppies te koop', why: 'gelaaide doppies' },
  { title: 'Selling a m m u n i t i o n, R6 each', why: 'spaced letters' },
  { title: 'Selling 4mmun1t10n, R6 each', why: 'leetspeak' },
  { title: 'a.m.m.u.n.i.t.i.o.n for sale', why: 'dotted' },

  // ── The explicit terms ───────────────────────────────────────────────
  { title: '500 rounds of 9mm for sale', why: 'quantity + calibre + offer' },
  { title: '1 000 rounds available', why: 'quantity with a thousands space' },
  { title: 'Comes with 200 rounds included', why: 'thrown in with the item' },
  { title: '20 rounds per box, R450', why: 'smallest realistic box' },
  { title: 'Factory ammunition', why: 'spelled-out product noun' },
  { title: 'Selling 50 live rounds', why: 'live rounds' },
  { title: 'live rounds included with the sale', why: 'live rounds, no count' },
  { title: 'Loaded ammo for the range', why: 'loaded ammo' },
  { title: 'Loaded cartridges, boat-tail', why: 'loaded cartridges' },
  { title: 'Hand-loaded rounds, worked up load', why: 'hand-loaded rounds' },
  { title: 'Reloaded ammunition, 100 available', why: 'reloaded ammunition' },
  { title: 'Selling ammo, R8 a shot', why: 'clipped noun + supply marker' },
  { title: 'Ammo in stock', why: 'clipped noun + stock marker' },
  { title: '100 cartridges for sale, R6 each', why: 'cartridges by count' },
  { title: '250 shells for sale', why: 'shotgun shells by count' },
  {
    title: 'Bergara B14 HMR rifle',
    description: 'Excellent condition, one owner. Comes with 200 rounds.',
    why: 'the wear veto must not survive a bundle marker',
  },
  {
    title: 'Range clear-out',
    description: 'Rifle in good condition. 500 rounds, R6 each.',
    why: 'a per-unit price attached to a round count',
  },

  // ── Context crosses the title/description boundary ───────────────────
  {
    title: 'CCI Standard Velocity',
    description: '.22LR, 500 rounds, R1500',
    why: 'brand in the title, count in the description',
  },
  {
    title: 'Sub-sonic 9mm',
    description: 'x 500, R6 each',
    why: 'calibre in the title, count in the description',
  },
  {
    title: '12ga birdshot',
    description: '250 shells, R1200',
    why: 'shot type in the title',
  },
  { title: 'Bulk 9mm', description: '1000 available', why: 'bulk phrasing' },
  {
    title: 'Somchem S321',
    description: '1kg unopened, R900',
    why: 'propellant sold by weight (RELOADING_SUPPLY)',
  },
  {
    title: 'Range day clear-out',
    description: [
      '• Bergara B14 HMR .308',
      '• 1000 rounds 9mm for sale, R6 each',
      '• Hard case',
    ].join('\n'),
    why: 'a line break is a clause boundary — the bullet is its own offer',
  },

  // ── Primers and propellant (RELOADING_SUPPLY, not AMMUNITION) ────────
  { title: '1000 CCI large rifle primers, sealed', why: 'primers by count' },
  { title: 'Large rifle primers for sale', why: 'primers for sale' },
  { title: '1kg of powder', why: 'powder by weight' },
  { title: '1kg Somchem S321 powder, unopened', why: 'named propellant' },
];

// The suffix that broke the guard. Every rejection above is re-tested with it
// appended to every field, because ", no offers" is what a real seller types
// and what a real bypasser reaches for once they learn the rule.
const withNoOffers = (c: Case): Case => ({
  title: `${c.title}, no offers`,
  description:
    c.description === undefined
      ? undefined
      : `${c.description.replace(/[.\s]+$/, '')}, no offers`,
  why: `${c.why} — plus ", no offers", which used to unlock everything`,
});

const MUST_REJECT: Case[] = [
  ...MUST_REJECT_CORE,
  ...MUST_REJECT_CORE.map(withNoOffers),
];

// ═══════════════════════════════════════════════════════════════════════
// MUST_PASS — honest sellers. Half of this file is here on purpose: being
// wrongly told "you may not sell ammunition" is worse than a near miss,
// because the seller did the right thing and the platform called them a
// criminal for it. Claude moderation is the backstop behind the guard, so
// when in doubt this array wins.
// ═══════════════════════════════════════════════════════════════════════

const MUST_PASS: Case[] = [
  // ── Ordinary round-count WEAR copy — the commonest sentence here ─────
  {
    title: 'Rifle in as-new condition, 400 rounds and nothing more',
    why: 'wear copy: a bare count with no sale signal',
  },
  { title: '1200 rounds, one owner', why: 'wear copy' },
  { title: 'Bolt action, 1500 rounds, immaculate', why: 'wear copy' },
  { title: 'Rifle has done 500 rounds', why: 'wear copy' },
  {
    title: 'Bought new, 300 rounds later I am selling',
    why: 'wear copy — "selling" is in the same clause as "rounds later"',
  },
  { title: 'Excellent condition, 250 rounds total', why: 'counted "total"' },
  { title: 'Approx 300 rounds fired, excellent bore', why: 'hedged estimate' },
  { title: 'Less than 500 rounds through the barrel', why: 'hedged estimate' },
  { title: 'Only 200 rounds since new', why: 'hedged estimate' },
  { title: 'Under 1000 rounds, barrel still crisp', why: 'hedged estimate' },
  {
    title: 'Round count is 450, all factory loads noted in log',
    why: 'round-count log entry',
  },
  {
    title: 'Immaculate rifle, safe queen, 1500 rounds, never abused, R22000',
    why: 'wear copy with a whole-item price (not a per-unit price)',
  },

  // ── Ammunition CARRIERS are permitted products ───────────────────────
  { title: 'Ammo wallet, 30 rounds', why: 'carrier product; count is a spec' },
  { title: 'MTM case, 100 rounds', why: 'carrier product' },
  { title: 'Bandolier, 50 shells', why: 'carrier product' },
  { title: 'Leather cartridge belt, 24 rounds', why: 'carrier product' },
  { title: 'Hunting vest with loops for 25 shells', why: 'capacity phrasing' },
  { title: 'Shell holder rack, 100 shells', why: 'carrier product' },
  { title: 'MTM ammo box, 100 round capacity', why: 'capacity phrasing' },
  { title: 'Ammo box for sale, holds 50', why: 'carrier product for sale' },
  { title: 'Ammo pouch, MOLLE, for sale', why: 'carrier product for sale' },
  { title: 'Ammo box, holds 50 rounds', why: 'carrier product' },
  { title: '30 round magazine, steel body', why: 'capacity, not a count' },
  { title: '5 round internal magazine', why: 'capacity below the minimum' },
  { title: '10 round mag included', why: 'capacity below the minimum' },

  // ── Honest DISCLAIMERS — the worst thing the guard can get wrong ─────
  {
    title: 'Buyer must supply their own ammunition',
    why: 'disclaimer: the exact opposite of an offer',
  },
  { title: "Ammunition is the buyer's responsibility", why: 'disclaimer' },
  {
    title: 'Please note: ammunition is not part of this sale',
    why: 'disclaimer',
  },
  { title: 'Ammunition is easy to find for this calibre', why: 'disclaimer' },
  { title: 'Cheap to shoot, ammunition widely available', why: 'disclaimer' },
  { title: 'Rifle only, no ammunition included', why: 'disclaimer' },
  { title: 'Ammunition not included', why: 'disclaimer' },
  { title: 'Strictly no live ammo with this sale', why: 'disclaimer' },
  {
    title: 'We do not sell ammunition on this platform',
    why: 'quoting the rule',
  },
  {
    title:
      'Great starter setup, comes with 3 magazines: ammunition is not part of this sale',
    why: 'disclaimer in a different clause of the same sentence',
  },

  // ── Reloading EQUIPMENT throughput copy ──────────────────────────────
  {
    title: 'Powder measure, throws consistent charges for 1000 rounds',
    why: 'a powder measure is a tool, and throughput is its selling point',
  },
  {
    title: 'RCBS reloading press with dies, makes 500 rounds an hour',
    why: 'throughput copy',
  },
  {
    title: 'Bullet feeder, good for 600 rounds an hour',
    why: 'throughput copy',
  },
  {
    title: 'Powder funnel set, fits .22 through .45',
    why: 'reloading equipment',
  },
  { title: 'Hand priming tool with shell holders', why: 'reloading equipment' },
  { title: 'Primer pocket uniformer and swager', why: 'reloading equipment' },
  {
    title: 'RCBS powder scale, 0.1 grain accuracy',
    why: 'reloading equipment',
  },
  { title: 'Powder trickler, brass body', why: 'reloading equipment' },

  // ── Permitted components, and everything else ────────────────────────
  { title: '147gr projectiles, 500 in the box', why: 'projectiles are lawful' },
  { title: '500 x 147gr projectiles', why: 'projectiles are lawful' },
  { title: 'once-fired brass', why: 'brass cases are lawful' },
  {
    title: '1000 pieces of once fired .308 brass',
    why: 'brass cases are lawful',
  },
  {
    title: '500 primed cases, ready to load',
    why: 'primed brass, not primers',
  },
  {
    title: 'RCBS .308 reloading dies, full length',
    why: 'reloading equipment',
  },
  { title: 'Enough components for 500 rounds', why: 'component listing' },
  {
    title: 'Bergara B14 HMR chambered in .308 Winchester',
    why: 'a chambering is not an ammunition offer',
  },
  { title: 'Zeroed with factory ammo at 100m', why: 'tested-with copy' },
  {
    title: 'Scope was tested with factory ammo, holds zero',
    why: 'tested-with copy',
  },
  {
    title: '20 gas cartridges for the camp stove',
    why: 'not a firearm cartridge',
  },
  { title: '25 CO2 cartridges, 12g powerlets', why: 'not a firearm cartridge' },
  {
    title: 'Collection on the 23rd of the month',
    why: 'an ordinal, not "rds"',
  },
  {
    title: 'Reloading clear-out',
    description: [
      '• 1000 x 147gr projectiles',
      '• Once-fired brass, sized and trimmed',
      '• Approx 300 rounds fired through the rifle it was worked up on',
    ].join('\n'),
    why: 'an honest bullet list of components',
  },

  // ── The same honest copy with the boilerplate suffix attached ────────
  // The fix must not swing the other way: a seller who writes ", no offers"
  // is haggling, not smuggling.
  {
    title: 'Buyer must supply their own ammunition, no offers',
    why: 'a disclaimer with the boilerplate suffix',
  },
  {
    title: 'Rifle only, no ammunition included, no offers',
    why: 'a disclaimer with the boilerplate suffix',
  },
  {
    title: 'Bolt action, 1500 rounds, immaculate, no offers',
    why: 'wear copy with the boilerplate suffix',
  },
  {
    title: 'Rifle in as-new condition, 400 rounds and nothing more, no swops',
    why: 'wear copy with the boilerplate suffix',
  },
  {
    title: 'Ammo wallet, 30 rounds, no time wasters',
    why: 'a carrier product with the boilerplate suffix',
  },
  {
    title: '500 x 147gr projectiles, no offers',
    why: 'a component listing with the boilerplate suffix',
  },
  {
    title:
      'Powder measure, throws consistent charges for 1000 rounds, no offers',
    why: 'reloading equipment with the boilerplate suffix',
  },
  {
    title: 'MTM ammo box, 100 round capacity, price not negotiable',
    why: 'a carrier product with the boilerplate suffix',
  },

  // ── Whole-listing context, in both directions ────────────────────────
  {
    title: 'Leather cartridge belt',
    description: 'Holds 24 rounds. Hand stitched, R850.',
    why: 'a carrier named in the title excuses a count in the description',
  },
  {
    title: 'Reloading clear-out',
    description:
      'Sized and trimmed once-fired brass, plus a bag of 147gr projectiles. Enough for 500 rounds.',
    why: 'a component named far away excuses the count',
  },
  {
    title: 'Range report',
    description:
      'Immaculate rifle, safe queen, 1500 rounds, never abused, R22000',
    why: 'wear copy in one clause excuses a count in another',
  },
  {
    title: 'Bergara B14 HMR .308 Win',
    description: 'R18000, 400 rounds, for sale, collect Pretoria',
    why: 'a used rifle priced and offered for sale',
  },
  {
    title: '9mm cleaning brushes',
    description: 'x 100 available, R9 each',
    why: 'a bulk accessory in a calibre — no ammunition profile anywhere',
  },
  {
    title: 'Ammo can',
    description: '.50 cal steel ammo can, holds 1000 rounds',
    why: 'an ammo can with a capacity',
  },
  {
    title: 'Rifle scope',
    description: 'Zeroed with factory ammo, 100 rounds through it',
    why: 'an optic tested with factory ammo',
  },
  {
    title: '147gr projectiles',
    description: '1000 x 147gr projectiles, R2.50 each, .308',
    why: 'projectiles priced per unit — a LAWFUL component listing',
  },
  {
    title: 'Tikka T3x .308',
    description:
      'Worked up with Varget, 400 rounds fired, 3.5kg with the scope',
    why: 'a rifle naming the powder its load was worked up with',
  },
  {
    title: 'Tikka T3x .308',
    description: '5 round magazine, R22000 for sale',
    why: 'a low-capacity magazine on a rifle',
  },
  {
    title: 'Range bag',
    description: '500 rounds capacity, R450',
    why: 'a range bag with a capacity spec',
  },
  {
    title: 'Shooting mat',
    description: '1200 rounds through my rifle on this mat',
    why: 'a mat described by the rounds shot on it',
  },
  {
    title: 'Bergara B14 HMR .308',
    description: 'Approx 300 rounds fired. Comes with a hard case.',
    why: 'a hedged round count plus a hard case',
  },
  {
    title: 'Bergara B14 HMR, 1200 rounds, one owner',
    description: 'Buyer must supply their own ammunition.',
    why: 'wear copy in the title, disclaimer in the description',
  },

  // ── A per-unit price on an ACCESSORY is not a per-unit price on rounds ──
  // The fix that lets a price in the sibling field convict a round count has
  // to stop short of these, or every used rifle sold with spare magazines
  // becomes an ammunition advert.
  {
    title: 'Bergara B14 HMR .308',
    description: '400 rounds fired. Spare magazines R450 each.',
    why: "wear in the count's own clause beats a per-unit price elsewhere",
  },
  {
    title: 'Tikka T3x .308, 1200 rounds, one owner',
    description: 'Spare mags R450 each, sling R150 each.',
    why: 'a bare wear count plus an accessory priced per unit',
  },
  {
    title: 'Reloading bench clear-out',
    description: 'Shell holders R80 each. Press has done 5000 rounds.',
    why: 'reloading equipment priced per unit',
  },

  // ── "Ammo <container>" is a storage product, even as a title ──────────
  // Rule 4 now treats the word "ammo" in a TITLE as the product name, so the
  // carrier vocabulary is load-bearing: these are Shooting Accessories.
  { title: 'Ammo crate, wooden, R350', why: 'a storage crate, not ammunition' },
  { title: 'Ammo tin, 30 cal, R120', why: 'a storage tin, not ammunition' },
  { title: 'Ammo storage locker for sale', why: 'a storage locker' },
  { title: 'Ammo case, hard shell, R400', why: 'a hard case' },
];

// ═══════════════════════════════════════════════════════════════════════
// The two corpora, executed against the real guard
// ═══════════════════════════════════════════════════════════════════════

// MUST_REJECT is an ADVERSARIAL corpus, not a specification of guaranteed
// behaviour, and it is deliberately not asserted string-by-string.
//
// Three rounds of attackers wrote these, each round inventing whatever the
// previous guard could not see. Chasing 100% of it is what produced the
// previous version: twenty interacting regexes that missed "9mm rounds for
// sale, R6 each" while rejecting ammunition SAFES, brass, projectiles and
// primer seating tools. The guard is now deliberately biased — it stands down
// whenever the text is ambiguous, because Claude moderation runs on all three
// write paths (previewDraft, create, update) and a regex miss is a handoff,
// not a hole. A false positive, by contrast, accuses a lawful seller of
// something they cannot fix.
//
// So this asserts a FLOOR and forbids regression, rather than perfection:
//   • the catch rate may not fall
//   • the blatant cases (BLATANT below) must never slip
//   • MUST_PASS is the hard invariant and is asserted individually
//
// If you improve the guard, raise CATCH_FLOOR to the new number. If a change
// drops it, you have traded away coverage — make that trade knowingly.
const CATCH_FLOOR = 127; // measured 2026-08-12: 127 of 186

describe('MUST_REJECT (adversarial corpus — floor, not spec)', () => {
  it(`catches at least ${CATCH_FLOOR} of ${MUST_REJECT.length}`, () => {
    const missed = MUST_REJECT.filter(
      (c) => findLiveAmmunitionListing(c.title, c.description ?? null) === null,
    );
    const caught = MUST_REJECT.length - missed.length;
    if (caught < CATCH_FLOOR) {
      console.log(
        '\nRegression — newly missed:\n' +
          missed.map((c) => `  · [${c.why}] ${c.title}`).join('\n'),
      );
    }
    expect(caught).toBeGreaterThanOrEqual(CATCH_FLOOR);
  });

  // The cases that must NEVER slip: a seller writing plainly what they are
  // selling. If any of these regress, the guard is not doing its job at all.
  const BLATANT: Case[] = [
    { title: 'Ammunition', why: 'the bare word as a product name' },
    { title: '9mm rounds for sale, R6 each', why: 'plain offer' },
    { title: '500rds 9mm Luger FMJ, R6 each, no offers', why: 'boilerplate suffix' },
    { title: '1000 rounds of 9mm in original factory boxes, R6500', why: 'rounds of <calibre>' },
    { title: 'Live ammunition for sale', why: 'the phrase itself' },
    { title: 'Training ammo 9mm, R6 a round, in stock', why: 'ammo title with a calibre' },
    { title: '500 rounds of .223 Remington for sale', why: 'rounds of <calibre>' },
    {
      title: 'Clearing the safe',
      description: '500 rounds\n9mm Luger\nR6 each\nCollect Pretoria',
      why: 'per-unit price beats the container word',
    },
  ];
  it.each(BLATANT)('never misses [$why]: $title', ({ title, description }) => {
    expect(
      findLiveAmmunitionListing(title, description ?? null),
    ).not.toBeNull();
  });
});

describe('MUST_PASS', () => {
  // Every single-field case is exercised BOTH ways round, because the guard
  // treats a title as the product name and a description as prose.
  it.each(MUST_PASS)('allows [$why]: $title', ({ title, description }) => {
    if (description === undefined) {
      expect(asTitle(title)).toBeNull();
      expect(asDescription(title)).toBeNull();
      expect(findLiveAmmunitionListing(title, null)).toBeNull();
      expect(findLiveAmmunitionListing('For sale', title)).toBeNull();
    } else {
      expect(findLiveAmmunitionListing(title, description)).toBeNull();
    }
  });
});

describe('corpus integrity', () => {
  // A corpus that quietly shrinks is how the last version of this file ended
  // up green while seven bypasses were live.
  it('is big enough to be worth running', () => {
    expect(MUST_REJECT.length).toBeGreaterThanOrEqual(150);
    expect(MUST_PASS.length).toBeGreaterThanOrEqual(70);
  });

  it('has no string in both corpora', () => {
    const key = (c: Case) => `${c.title}\u0000${c.description ?? ''}`;
    const rejected = new Set(MUST_REJECT.map(key));
    for (const c of MUST_PASS) expect(rejected.has(key(c))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Which ban was tripped — live ammunition and reloading supplies are two
// different prohibitions with two different messages.
// ═══════════════════════════════════════════════════════════════════════

describe('ban attribution', () => {
  it.each([
    '1000 CCI large rifle primers, sealed',
    'Large rifle primers for sale',
    '1kg of powder',
    '1kg Somchem S321 powder, unopened',
    '1000 CCI small rifle primers for sale, R900, no offers',
    '500g Varget powder, R700, no swops',
  ])('calls primers/propellant a RELOADING_SUPPLY: %s', (text) => {
    expect(asTitle(text)?.ban).toBe('RELOADING_SUPPLY');
  });

  it.each([
    '500 rounds of 9mm for sale',
    '9mm ammo R450',
    '1000 rounds of 9mm in original factory boxes, R6500',
  ])('calls live rounds an AMMUNITION hit: %s', (text) => {
    expect(asTitle(text)?.ban).toBe('AMMUNITION');
  });

  it('reports the title when the title is the offender', () => {
    const hit = findLiveAmmunitionListing(
      '500 rounds of 9mm for sale',
      'Clean listing',
    );
    expect(hit?.field).toBe('title');
  });

  it('reports the description when only the description offends', () => {
    const hit = findLiveAmmunitionListing(
      'Glock 17 Gen 5',
      '500 rounds of 9mm for sale, R6 each',
    );
    expect(hit?.field).toBe('description');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// The category guard
// ═══════════════════════════════════════════════════════════════════════

describe('isLiveAmmunitionCategory', () => {
  it('flags the seeded (inactive) ammo category', () => {
    expect(isLiveAmmunitionCategory({ slug: 'ammo', name: 'Ammo' })).toBe(true);
  });

  it('flags a future child of the ammo tree via its parent', () => {
    expect(
      isLiveAmmunitionCategory({
        slug: 'rimfire',
        name: 'Rimfire',
        parent: { slug: 'ammo', name: 'Ammo' },
      }),
    ).toBe(true);
  });

  it('flags a spelled-out ammunition category added later', () => {
    expect(
      isLiveAmmunitionCategory({
        slug: 'shotgun-ammunition',
        name: 'Shotgun Ammunition',
      }),
    ).toBe(true);
  });

  it('does NOT flag Shooting Accessories › Ammo Boxes & Storage Cases', () => {
    expect(
      isLiveAmmunitionCategory({
        slug: 'ammo-boxes-and-storage-cases',
        name: 'Ammo Boxes & Storage Cases',
        parent: { slug: 'shooting-accessories', name: 'Shooting Accessories' },
      }),
    ).toBe(false);
  });

  it('does NOT flag Shooting Accessories › Ammo Pouch', () => {
    expect(
      isLiveAmmunitionCategory({ slug: 'ammo-pouch', name: 'Ammo Pouch' }),
    ).toBe(false);
  });

  it.each([
    ['reloading-components', 'Reloading Components'],
    ['rifle-bullets', 'Rifle Bullets'],
    ['handgun-brass-cases', 'Handgun Brass Cases'],
    ['reloading-equipment', 'Reloading Equipment'],
    ['paintballs', 'Paintballs'],
    ['firearms', 'Firearms'],
    ['camping-outdoor', 'Camping & Outdoor'],
  ])('does NOT flag %s', (slug, name) => {
    expect(isLiveAmmunitionCategory({ slug, name })).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// All three write paths
// ═══════════════════════════════════════════════════════════════════════

const AMMO_CATEGORY = {
  id: 'cat-ammo',
  slug: 'ammo',
  name: 'Ammo',
  parent: null,
  isActive: true,
  availableSecondhand: true,
  isFirearm: false,
};

const RELOADING_CATEGORY = {
  id: 'cat-reload',
  slug: 'reloading-components',
  name: 'Reloading Components',
  parent: null,
  isActive: true,
  availableSecondhand: true,
  isFirearm: false,
  collectionOnly: false,
  isExperience: false,
  requiresPapers: false,
  showTestedWorkingAttestation: false,
  publicVisible: false,
};

type ModerationStub = {
  isEnabled: boolean;
  moderate: jest.Mock;
  stripContactInfo: jest.Mock;
};

function makeService(
  over: {
    category?: unknown;
    listing?: unknown;
    moderation?: Partial<ModerationStub>;
    moderationFlag?: boolean;
  } = {},
) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'u1',
        clerkId: 'clerk_1',
        isBanned: false,
        sellingBannedAt: null,
      }),
    },
    category: {
      findUnique: jest.fn().mockResolvedValue(over.category ?? AMMO_CATEGORY),
    },
    listing: {
      findUnique: jest.fn().mockResolvedValue(over.listing ?? null),
      update: jest.fn(),
    },
    offer: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const settings = {
    get: jest.fn().mockImplementation((flag: { key: string }) => {
      if (flag?.key === 'claude_moderation_enabled')
        return Promise.resolve(over.moderationFlag ?? false);
      if (flag?.key === 'dg_lithium_wh_threshold') return Promise.resolve(100);
      return Promise.resolve(false);
    }),
  };
  const search = {
    isConnected: false,
    deleteDocument: jest.fn().mockResolvedValue(undefined),
  };
  const moderation: ModerationStub = {
    isEnabled: false,
    moderate: jest.fn(),
    stripContactInfo: jest.fn((s: string) => ({ cleaned: s })),
    ...(over.moderation ?? {}),
  };
  const service = new ListingsService(
    prisma as never,
    search as never,
    {} as never, // cloudinary
    moderation as never,
    settings as never,
    {} as never, // referenceNumbers
    {} as never, // firearmLicence
    { getEffectiveAttributes: jest.fn().mockResolvedValue([]) } as never,
    { notifyPriceDrop: jest.fn().mockResolvedValue(undefined) } as never,
    { record: jest.fn() } as never, // activity
    // Real calculator, not a stub — dependency-free, and it keeps the
    // BUY_NOW markup maths honest wherever a spec touches pricing.
    new FeeCalculator(),
  );
  return { service, prisma, search, moderation };
}

const cleanDraft = {
  categoryId: 'cat-reload',
  listingType: 'BUY_NOW',
  title: '500 x 147gr projectiles',
  description: 'Once-fired brass, sized and trimmed.',
  price: 150000,
};

describe('previewDraft — ammunition ban', () => {
  it('rejects the ammo category', async () => {
    const { service } = makeService();
    await expect(
      service.previewDraft('clerk_1', {
        ...cleanDraft,
        categoryId: 'cat-ammo',
      } as never),
    ).rejects.toThrow(AMMUNITION_BAN_MESSAGE);
  });

  it('rejects live ammunition hidden in an innocent category', async () => {
    const { service } = makeService({ category: RELOADING_CATEGORY });
    await expect(
      service.previewDraft('clerk_1', {
        ...cleanDraft,
        title: 'Reloading bundle',
        description: 'Includes 500 rounds of factory ammunition.',
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects the count+calibre profile the old guard could not see', async () => {
    const { service } = makeService({ category: RELOADING_CATEGORY });
    await expect(
      service.previewDraft('clerk_1', {
        ...cleanDraft,
        title: '500 rounds of 9mm for sale, R6 each',
        description: 'Collect in Pretoria.',
      } as never),
    ).rejects.toThrow(AMMUNITION_BAN_MESSAGE);
  });

  it('rejects the boilerplate-suffixed advert on the preview path too', async () => {
    const { service } = makeService({ category: RELOADING_CATEGORY });
    await expect(
      service.previewDraft('clerk_1', {
        ...cleanDraft,
        title: '500rds 9mm Luger FMJ, R6 each, no offers',
        description: 'Collect in Pretoria, no time wasters.',
      } as never),
    ).rejects.toThrow(AMMUNITION_BAN_MESSAGE);
  });

  it('rejects primers with the PRIMER message, not the ammunition one', async () => {
    const { service } = makeService({ category: RELOADING_CATEGORY });
    await expect(
      service.previewDraft('clerk_1', {
        ...cleanDraft,
        title: '1000 CCI large rifle primers',
        description: 'Sealed sleeve.',
      } as never),
    ).rejects.toThrow(RELOADING_SUPPLY_BAN_MESSAGE);
  });

  it('lets a genuine reloading-components draft through the gate', async () => {
    const { service } = makeService({ category: RELOADING_CATEGORY });
    const result = await service.previewDraft('clerk_1', cleanDraft as never);
    // Moderation is disabled in this harness, so a draft that survives the
    // ammunition gate comes back as a clean, publishable preview.
    expect(result.canPublish).toBe(true);
    expect(result.decision).toBe('APPROVE');
  });

  it('lets an honest used-rifle draft through the gate', async () => {
    const { service } = makeService({ category: RELOADING_CATEGORY });
    const result = await service.previewDraft('clerk_1', {
      ...cleanDraft,
      title: 'Bergara B14 HMR .308 Winchester',
      description: 'Excellent condition, 400 rounds and nothing more.',
    } as never);
    expect(result.canPublish).toBe(true);
  });
});

describe('create — ammunition ban', () => {
  it('rejects the ammo category', async () => {
    const { service } = makeService();
    await expect(
      service.create('clerk_1', {
        ...cleanDraft,
        categoryId: 'cat-ammo',
      } as never),
    ).rejects.toThrow(AMMUNITION_BAN_MESSAGE);
  });

  it('gives the ban message (not "invalid category") for the seeded inactive ammo category', async () => {
    // prisma/seed.ts keeps `ammo` at isActive:false and it must STAY inactive —
    // but "Invalid category" reads like a glitch worth retrying. The ban check
    // deliberately runs first so the seller reads the actual rule.
    const { service } = makeService({
      category: { ...AMMO_CATEGORY, isActive: false },
    });
    await expect(
      service.create('clerk_1', {
        ...cleanDraft,
        categoryId: 'cat-ammo',
      } as never),
    ).rejects.toThrow(AMMUNITION_BAN_MESSAGE);
  });

  it('rejects a quantity of rounds offered from an innocent category', async () => {
    const { service } = makeService({ category: RELOADING_CATEGORY });
    await expect(
      service.create('clerk_1', {
        ...cleanDraft,
        title: 'Live ammunition for sale, 500 rounds 9mm',
      } as never),
    ).rejects.toThrow(AMMUNITION_BAN_MESSAGE);
  });

  it('rejects the packaging-laundered phrasing', async () => {
    const { service } = makeService({ category: RELOADING_CATEGORY });
    await expect(
      service.create('clerk_1', {
        ...cleanDraft,
        title: 'Range clear-out',
        description: '500 rounds of .223 Remington for sale, R7 each.',
      } as never),
    ).rejects.toThrow(AMMUNITION_BAN_MESSAGE);
  });

  it('does NOT reject a reloading-components listing', async () => {
    const { service } = makeService({ category: RELOADING_CATEGORY });
    // The listing clears the ammunition gate and falls over later, on an
    // unrelated required field — proof the gate let it past rather than that
    // the whole call succeeded.
    await expect(
      service.create('clerk_1', {
        ...cleanDraft,
        price: undefined,
      } as never),
    ).rejects.toThrow(/Price is required/);
  });

  it('does NOT reject honest wear copy on a used rifle', async () => {
    const { service } = makeService({ category: RELOADING_CATEGORY });
    await expect(
      service.create('clerk_1', {
        ...cleanDraft,
        title: 'Bergara B14 HMR, 1200 rounds, one owner',
        description: 'Buyer must supply their own ammunition.',
        price: undefined,
      } as never),
    ).rejects.toThrow(/Price is required/);
  });
});

describe('update — ammunition ban', () => {
  const liveListing = {
    id: 'L1',
    sellerId: 'u1',
    categoryId: 'cat-reload',
    status: 'ACTIVE',
    listingType: 'BUY_NOW',
    bidCount: 0,
    title: '500 x 147gr projectiles',
    description: 'Once-fired brass.',
    isFirearm: false,
    collectionOnly: false,
    price: 150000,
    compareAtPriceZarCents: null,
    declaredValueCents: null,
    autoAcceptThreshold: null,
    autoDeclineThreshold: null,
    privateArrangeConsentAt: null,
    priceDropNotifiedAt: null,
  };

  it('rejects an innocent listing edited INTO ammunition', async () => {
    const { service } = makeService({
      category: RELOADING_CATEGORY,
      listing: liveListing,
    });
    await expect(
      service.update('L1', 'clerk_1', {
        title: 'Live ammunition for sale, 500 rounds of 9mm',
      }),
    ).rejects.toThrow(AMMUNITION_BAN_MESSAGE);
  });

  it('catches ammunition added to the description only', async () => {
    const { service } = makeService({
      category: RELOADING_CATEGORY,
      listing: liveListing,
    });
    await expect(
      service.update('L1', 'clerk_1', {
        description: 'Now bundled with loaded ammo.',
      }),
    ).rejects.toThrow(AMMUNITION_BAN_MESSAGE);
  });

  it('catches the count+calibre profile added on edit', async () => {
    const { service } = makeService({
      category: RELOADING_CATEGORY,
      listing: { ...liveListing, title: 'Range clear-out', description: '' },
    });
    await expect(
      service.update('L1', 'clerk_1', {
        description: 'Bulk 5.56 - 1000 available, R9 each.',
      }),
    ).rejects.toThrow(AMMUNITION_BAN_MESSAGE);
  });

  it('rejects a PATCH that only changes the title when the STORED description offends', async () => {
    const { service } = makeService({
      category: RELOADING_CATEGORY,
      listing: {
        ...liveListing,
        description: 'Includes 500 rounds of 9mm, R6 each.',
      },
    });
    await expect(
      service.update('L1', 'clerk_1', { title: 'Reloading bundle' }),
    ).rejects.toThrow(AMMUNITION_BAN_MESSAGE);
  });

  it('rejects a move INTO the ammo category', async () => {
    const { service } = makeService({
      category: AMMO_CATEGORY,
      listing: liveListing,
    });
    await expect(
      service.update('L1', 'clerk_1', { categoryId: 'cat-ammo' }),
    ).rejects.toThrow(AMMUNITION_BAN_MESSAGE);
  });

  it('does NOT block an ordinary edit to a reloading-components listing', async () => {
    const { service, prisma } = makeService({
      category: RELOADING_CATEGORY,
      listing: liveListing,
    });
    // Stop the call at the next DB write so we only assert the gate passed.
    prisma.listing.update = jest
      .fn()
      .mockRejectedValue(new Error('reached the write'));
    await expect(
      service.update('L1', 'clerk_1', {
        description: '1000 x 147gr projectiles added, plus once-fired brass.',
      }),
    ).rejects.toThrow('reached the write');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// The edit path has the Claude backstop the deterministic guard needs
// ═══════════════════════════════════════════════════════════════════════

describe('update — Claude moderation backstop', () => {
  const liveListing = {
    id: 'L1',
    sellerId: 'u1',
    categoryId: 'cat-reload',
    status: 'ACTIVE',
    listingType: 'BUY_NOW',
    bidCount: 0,
    title: 'Bergara B14 HMR chambered in .308 Winchester',
    description: 'Excellent condition, 400 rounds and nothing more.',
    isFirearm: false,
    collectionOnly: false,
    price: 150000,
    compareAtPriceZarCents: null,
    declaredValueCents: null,
    autoAcceptThreshold: null,
    autoDeclineThreshold: null,
    privateArrangeConsentAt: null,
    priceDropNotifiedAt: null,
  };

  // Typed views over the jest mock calls, so the assertions below stay
  // type-safe instead of poking at `any`.
  const updateData = (update: jest.Mock): Record<string, unknown> => {
    const call = update.mock.calls[0] as [{ data: Record<string, unknown> }];
    return call[0].data;
  };
  const moderateInput = (
    moderate: jest.Mock,
  ): { title: string; description: string } => {
    const call = moderate.mock.calls[0] as [
      { title: string; description: string },
    ];
    return call[0];
  };

  function harness(decision: string, extra: Record<string, unknown> = {}) {
    const kit = makeService({
      category: RELOADING_CATEGORY,
      listing: liveListing,
      moderationFlag: true,
      moderation: {
        isEnabled: true,
        moderate: jest.fn().mockResolvedValue({
          decision,
          confidence: 0.9,
          reasons: ['ammunition offered for sale'],
          ...extra,
        }),
      },
    });
    kit.prisma.listing.update = jest
      .fn()
      .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          ...liveListing,
          ...data,
          images: [],
          category: RELOADING_CATEGORY,
        }),
      );
    return kit;
  }

  it('runs the moderator on a description edit (it never used to)', async () => {
    const kit = harness('APPROVE');
    await kit.service.update('L1', 'clerk_1', {
      description: 'Now with a hard case and a bipod.',
    });
    expect(kit.moderation.moderate).toHaveBeenCalledTimes(1);
  });

  it('judges the EFFECTIVE merged values, not just the incoming field', async () => {
    const kit = harness('APPROVE');
    await kit.service.update('L1', 'clerk_1', {
      title: 'Bergara B14 HMR — price drop',
    });
    const arg = moderateInput(kit.moderation.moderate);
    expect(arg.title).toBe('Bergara B14 HMR — price drop');
    // the stored description came along for the ride
    expect(arg.description).toBe(liveListing.description);
  });

  it('sends a REJECTed edit to PENDING_REVIEW and evicts the search doc', async () => {
    const kit = harness('REJECT');
    const updated = await kit.service.update('L1', 'clerk_1', {
      description: 'Ammunition-adjacent phrasing a pattern cannot see.',
    });
    expect(updateData(kit.prisma.listing.update).status).toBe('PENDING_REVIEW');
    expect(updated.status).toBe('PENDING_REVIEW');
    expect(kit.search.deleteDocument).toHaveBeenCalledWith('listings', 'L1');
  });

  it('applies an AUTO_FIX cleaned description', async () => {
    const kit = harness('AUTO_FIX_AND_APPROVE', {
      cleanedDescription: 'Call me on [REDACTED]',
    });
    await kit.service.update('L1', 'clerk_1', {
      description: 'Call me on 082 123 4567',
    });
    const data = updateData(kit.prisma.listing.update);
    expect(data.description).toBe('Call me on [REDACTED]');
    expect(data.claudeAutoFixApplied).toBe(true);
    expect(data.status).toBeUndefined();
  });

  it('does NOT burn a Claude call on a price-only edit', async () => {
    const kit = harness('APPROVE');
    await kit.service.update('L1', 'clerk_1', { price: 140000 });
    expect(kit.moderation.moderate).not.toHaveBeenCalled();
  });

  it('applies the edit without moderation when the flag is off', async () => {
    const kit = makeService({
      category: RELOADING_CATEGORY,
      listing: liveListing,
      moderationFlag: false,
      moderation: { isEnabled: true, moderate: jest.fn() },
    });
    kit.prisma.listing.update = jest.fn().mockResolvedValue({
      ...liveListing,
      images: [],
      category: RELOADING_CATEGORY,
    });
    await kit.service.update('L1', 'clerk_1', {
      description: 'Tidied up the wording.',
    });
    expect(kit.moderation.moderate).not.toHaveBeenCalled();
  });
});

describe('AMMUNITION_BAN_MESSAGE', () => {
  it('states the prohibition plainly and tells the seller not to retry', () => {
    expect(AMMUNITION_BAN_MESSAGE).toContain('does not sell ammunition');
    expect(AMMUNITION_BAN_MESSAGE).toContain('under any circumstances');
    expect(AMMUNITION_BAN_MESSAGE).toMatch(/permanent platform rule/i);
    // It must also point the reloading seller at the path that IS open, or
    // the message reads as "regulated goods banned" and costs honest listings.
    expect(AMMUNITION_BAN_MESSAGE).toMatch(/Reloading components/i);
  });

  it('states the CORRECT component scope — no primers, no propellant', () => {
    // prisma/seed.ts: the only component categories are Rifle/Handgun Bullets
    // and Rifle/Handgun Brass Cases. Telling a seller that primers and powder
    // "remain lawful to list" would be false.
    expect(AMMUNITION_BAN_MESSAGE).toMatch(/projectiles \/ bullets/i);
    expect(AMMUNITION_BAN_MESSAGE).toMatch(/brass cases/i);
    expect(AMMUNITION_BAN_MESSAGE).toMatch(
      /Primers and propellant powder cannot be listed/i,
    );
    // …but reloading equipment must not be swept up with them.
    expect(AMMUNITION_BAN_MESSAGE).toMatch(/powder measures/i);
  });

  it('does NOT call primers or powder "ammunition"', () => {
    expect(RELOADING_SUPPLY_BAN_MESSAGE).not.toMatch(/ammunition/i);
    expect(RELOADING_SUPPLY_BAN_MESSAGE).toMatch(/projectiles/i);
    expect(RELOADING_SUPPLY_BAN_MESSAGE).toMatch(/brass cases/i);
    expect(RELOADING_SUPPLY_BAN_MESSAGE).toMatch(/powder measures/i);
  });
});
