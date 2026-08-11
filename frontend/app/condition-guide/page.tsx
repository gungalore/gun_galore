import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Condition guide — All Outdoor',
  description:
    'What NEW, LIKE NEW, GOOD, FAIR and POOR actually mean on All Outdoor, plus what to check before you grade optics, electronics, tents, packs and firearms. Grade honestly and your listing sells faster with fewer disputes.',
  alternates: { canonical: '/condition-guide' },
};

// Condition was a bare 5-value enum with no definition anywhere on the site,
// and the sell form defaulted to GOOD with zero guidance. On sight-unseen
// secondhand gear that is a dispute factory: one seller's "GOOD" scope has
// clear glass, another's has a scratched objective. The grades below are the
// shared definition every surface points at — the sell-form HelpTip and the
// listing-detail condition chip both link here.
//
// Copy rule: describe what the BUYER receives, never what the seller intended.
const GRADES: {
  code: string;
  label: string;
  headline: string;
  means: string[];
  notThis: string;
}[] = [
  {
    code: 'NEW',
    label: 'New',
    headline: 'Unused, still sealed or with tags — exactly as it left the shop.',
    means: [
      'Never used, never mounted, never fired, never pitched',
      'Original box, tags, caps, tools and paperwork still with it',
      'No marks of any kind, including mounting-ring marks or safe rash',
    ],
    notThis:
      '"New to me", or bought new and used twice — that is Like New at best.',
  },
  {
    code: 'LIKE_NEW',
    label: 'Like New',
    headline: 'Used, but you would struggle to tell from a metre away.',
    means: [
      'A handful of uses; everything works exactly as it should',
      'No functional wear at all — glass clear, zips smooth, seams intact',
      'At most faint handling marks you have to look for',
    ],
    notThis:
      'Anything with a visible scratch, scuff or fade a buyer would notice in a photo.',
  },
  {
    code: 'GOOD',
    label: 'Good',
    headline: 'Honestly used and fully working. The normal secondhand grade.',
    means: [
      'Visible cosmetic wear — scuffs, ring marks, faded fabric, minor dings',
      'Everything still functions as designed with nothing bodged or missing',
      'Ready to use as-is, no repairs needed before the buyer can rely on it',
    ],
    notThis:
      'A working item with a known fault or a missing part. Say so and grade it Fair.',
  },
  {
    code: 'FAIR',
    label: 'Fair',
    headline: 'Works, but with a fault, a missing part or heavy wear.',
    means: [
      'Heavy cosmetic wear, or a defect you must describe in full',
      'Missing accessories, caps, poles, cables, mounts or paperwork',
      'Something the buyer will need to live with, repair or replace',
    ],
    notThis:
      'Hiding the fault in the photos and mentioning it nowhere. Name it in the description.',
  },
  {
    code: 'POOR',
    label: 'Poor',
    headline: 'For parts, spares or a project. Do not expect it to work.',
    means: [
      'Broken, seized, water-damaged, or not functional as sold',
      'Sold on the understanding that the buyer is taking it on as a project',
      'Priced accordingly — the buyer is paying for parts, not performance',
    ],
    notThis:
      'A cheap way to offload something faulty as if it were a bargain. Be explicit.',
  },
];

// Category-aware checklists. Grading a rifle scope and grading a camping
// fridge need different questions; these are the ones that actually decide the
// grade (and the ones buyers complain about when nobody checked them).
const CHECKLISTS: { title: string; points: string[] }[] = [
  {
    title: 'Optics — scopes, binoculars, rangefinders',
    points: [
      'Hold the glass to a light: any scratch, fungus, haze or internal dust?',
      'Turrets click positively and return to zero; zoom and parallax move smoothly',
      'Ring marks on the tube, and whether caps, sunshade and tools are included',
      'Rangefinders and red dots: does it power on, and is the battery door clean of corrosion?',
    ],
  },
  {
    title: 'Camping electronics — fridges, power stations, lights',
    points: [
      'Does it power on and hold up on BOTH 12V and 220V where it supports them?',
      'A fridge must actually pull temperature down — say how cold and how long it took',
      'Battery health: age, cycles if you know them, and how long it holds charge now',
      'Corrosion on terminals, frayed cables, cracked housings',
    ],
  },
  {
    title: 'Tents, awnings and rooftop tents',
    points: [
      'Every zip run end to end — a failed zip is the single most common complaint',
      'Waterproofing: any delamination, perished seam tape, or leaks you know of',
      'All poles, pegs, guys and the bag present; poles free of cracks and bent sections',
      'Mould or musty smell — say so honestly; it does not wash out',
    ],
  },
  {
    title: 'Packs, clothing and boots',
    points: [
      'Zips, buckles, straps and stitching — anything already pulling loose?',
      'Fading, staining, and whether any waterproof membrane still beads water',
      'Boots: sole wear and any separation at the welt',
    ],
  },
  {
    title: 'Firearms and firearm parts',
    points: [
      'Bore and crown condition, plus an honest round count if you have any idea',
      'Bluing or finish wear, safe rash, stock dings and any repairs',
      'Function-check: action cycles, safety engages, trigger as it left the factory or modified',
      'Every part included — magazines, mounts, tools, case and original paperwork',
    ],
  },
];

export default function ConditionGuidePage() {
  return (
    <main className="max-w-[760px] mx-auto px-4 py-10">
      <h1
        className="text-3xl"
        style={{
          color: 'var(--text-primary)',
          fontWeight: 500,
          letterSpacing: '-0.01em',
        }}
      >
        Condition guide
      </h1>
      <p
        className="text-sm mt-2"
        style={{ color: 'var(--text-tertiary)', lineHeight: 1.6 }}
      >
        Buyers here are buying sight-unseen, so a condition grade is a promise.
        These are the definitions we hold everyone to — sellers and buyers
        alike. Grade honestly: an accurate <strong>Fair</strong> with the fault
        described sells faster, and with far less grief, than an optimistic{' '}
        <strong>Good</strong> that arrives and disappoints.
      </p>

      <div className="mt-8 flex flex-col gap-4">
        {GRADES.map((g) => (
          <section
            key={g.code}
            id={g.code.toLowerCase()}
            className="rounded-[10px] p-5"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
            }}
          >
            <h2
              className="text-lg"
              style={{ color: 'var(--text-primary)', fontWeight: 600 }}
            >
              {g.label}
            </h2>
            <p
              className="text-sm mt-1"
              style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}
            >
              {g.headline}
            </p>

            <p
              className="text-xs mt-4 mb-1"
              style={{
                color: 'var(--text-tertiary)',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              What it means
            </p>
            <ul className="flex flex-col gap-1">
              {g.means.map((m) => (
                <li
                  key={m}
                  className="text-sm"
                  style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}
                >
                  • {m}
                </li>
              ))}
            </ul>

            <p
              className="text-xs mt-3"
              style={{ color: 'var(--text-tertiary)', lineHeight: 1.6 }}
            >
              <strong style={{ color: 'var(--text-secondary)' }}>
                Not this:
              </strong>{' '}
              {g.notThis}
            </p>
          </section>
        ))}
      </div>

      <h2
        className="text-xl mt-10"
        style={{ color: 'var(--text-primary)', fontWeight: 600 }}
      >
        Check these before you grade
      </h2>
      <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>
        Two minutes here saves a dispute later.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        {CHECKLISTS.map((c) => (
          <section
            key={c.title}
            className="rounded-[10px] p-5"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
            }}
          >
            <h3
              className="text-base"
              style={{ color: 'var(--text-primary)', fontWeight: 600 }}
            >
              {c.title}
            </h3>
            <ul className="flex flex-col gap-1 mt-2">
              {c.points.map((p) => (
                <li
                  key={p}
                  className="text-sm"
                  style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}
                >
                  • {p}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div
        className="rounded-[10px] p-5 mt-6"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
      >
        <h2
          className="text-base"
          style={{ color: 'var(--text-primary)', fontWeight: 600 }}
        >
          If the item does not match its grade
        </h2>
        <p
          className="text-sm mt-1"
          style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}
        >
          Payment is held until the buyer confirms the item arrived as
          described. If it did not, raise it from your order page before
          confirming — our team reviews it and the payment stays held while we
          do. Sellers who consistently over-grade lose their standing on the
          platform.
        </p>
        <p className="text-sm mt-3">
          <Link
            href="/how-selling-works"
            style={{ color: 'var(--red)', textDecoration: 'none' }}
          >
            How selling works →
          </Link>
        </p>
      </div>
    </main>
  );
}
