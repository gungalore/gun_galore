import {
  COLOURWAYS,
  COLOURWAY_KEYS,
  FORMAT_FEATURES,
  FORMAT_KEYS,
  type Colourway,
  type TemplateFormat,
} from './motivation-pdf.service';

// ────────────────────────────────────────────────────────────────────
// THE TEMPLATE CATALOGUE — what the picker renders.
//
// Fifteen templates: five colourways x three formats. Operator, 2026-08-19:
// "Let's pick a variety of 5 colors to cover most peoples taste and then give
// them 3 formats of each."
//
// ⚠️ THE COLOURS AND THE SECTION SETS ARE NOT RESTATED HERE. They are read
// out of motivation-pdf.service.ts, which is what actually draws the document.
// A picker that carried its own copy of "#2A4A32" would be right on the day it
// was written and wrong the first time somebody adjusted the ink — and the
// failure mode is the worst kind: a member picks a colour, pays, and the PDF
// comes out a different one. The catalogue is a VIEW over the renderer.
//
// ⚠️ THE PREVIEW IS NOT A PDF, AND THAT IS A HARD PRODUCT CONSTRAINT. Operator,
// 2026-08-19: "we must never open it in a window with a print option to
// prevent them printing to pdf." So this endpoint serves TOKENS — the ink, the
// tint, which blocks a format shows — and the client draws a mock page out of
// them in the DOM. There is no document to print, no viewer toolbar, no
// download, and nothing on the wire that could be saved and passed on.
//
// Everything here is public product information: colour names and section
// lists. No applicant data, so this is served without an id and cached.
// ────────────────────────────────────────────────────────────────────

export interface TemplateFormatOption {
  key: TemplateFormat;
  name: string;
  /** One line under the name in the picker. */
  blurb: string;
  /** What this format adds over the one before it, for the comparison list. */
  includes: string[];
  /** Roughly how long the finished pack runs, so nobody is surprised. */
  lengthHint: string;
  /** Drives the mock page: which blocks the preview draws. */
  features: { contents: boolean; ownedTable: boolean; specBlock: boolean };
}

export interface TemplateColourOption {
  key: Colourway;
  name: string;
  ink: string;
  tint: string;
  rule: string;
}

/**
 * ⚠️ THE BLURBS DESCRIBE STRUCTURE, NEVER STRENGTH. "Comprehensive" adds
 * SECTIONS — a contents page, a table of what you already hold, a
 * specification sheet — and it does not add a better argument or a better
 * chance. Writing "the strongest option" here would be an outcome claim on a
 * product that never makes one, and it would also be false: the same facts
 * make the same case at any length.
 */
const FORMAT_COPY: Record<
  TemplateFormat,
  { name: string; blurb: string; includes: string[]; lengthHint: string }
> = {
  concise: {
    name: 'Concise',
    blurb: 'The argument on its own, and nothing around it.',
    includes: [
      'Cover page with your details',
      'The motivation itself',
      'Annexure index and your certified copies',
    ],
    lengthHint: 'Usually 4 to 6 pages before annexures',
  },
  standard: {
    name: 'Standard',
    blurb: 'Adds a contents page and a table of the firearms you already hold.',
    includes: [
      'Everything in Concise',
      'Contents page with page numbers',
      'Table of the firearms already licensed to you',
    ],
    lengthHint: 'Usually 6 to 8 pages before annexures',
  },
  comprehensive: {
    name: 'Comprehensive',
    blurb:
      'Adds a specification sheet for the firearm, set out as researched data.',
    includes: [
      'Everything in Standard',
      'Specification sheet for the firearm applied for',
      'Calibre, action, barrel, capacity and mass as published',
    ],
    lengthHint: 'Usually 8 to 10 pages before annexures',
  },
};

/**
 * Colour names, and only names.
 *
 * No "professional", no "authoritative", no "trustworthy". A reviewing officer
 * does not read a document differently because it is navy, and telling a
 * member otherwise would be selling them something that is not there. They
 * pick the one they like the look of.
 */
const COLOUR_NAMES: Record<Colourway, string> = {
  ochre: 'Ochre',
  navy: 'Navy',
  forest: 'Forest',
  oxblood: 'Oxblood',
  slate: 'Slate',
};

export interface TemplateCatalogue {
  formats: TemplateFormatOption[];
  colours: TemplateColourOption[];
  defaults: { format: TemplateFormat; colourway: Colourway };
}

export function templateCatalogue(): TemplateCatalogue {
  return {
    // Ordered shortest to longest, which is also the order the picker shows
    // them in — a member scanning left to right is scanning "how much".
    formats: FORMAT_KEYS.map((key) => ({
      key,
      ...FORMAT_COPY[key],
      features: FORMAT_FEATURES[key],
    })),
    colours: COLOURWAY_KEYS.map((key) => ({
      key,
      name: COLOUR_NAMES[key],
      ...COLOURWAYS[key],
    })),
    // ⚠️ MUST MATCH asFormat/asColourway in the renderer. Those fall back to
    // standard/slate for an unrecognised value, so a picker that opened on
    // anything else would show a member a selection their document does not
    // have.
    defaults: { format: 'standard', colourway: 'slate' },
  };
}
