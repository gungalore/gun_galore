import {
  DEFAULT_SCHEME,
  FORMAT_FEATURES,
  FORMAT_KEYS,
  SCHEMES,
  SCHEME_KEYS,
  type Scheme,
  type SchemeColours,
  type TemplateFormat,
} from './motivation-pdf.service';
import {
  DEFAULT_LAYOUT,
  LAYOUTS,
  LAYOUT_KEYS,
  type TemplateLayout,
} from './motivation-pdf-layouts';

// ────────────────────────────────────────────────────────────────────
// THE TEMPLATE CATALOGUE — what the picker renders.
//
// ONE FORMAT, TEN SCHEMES. Operator, 2026-08-21: "get rid of the concise and
// standard templates. Only comprehensive stays." So the picker's job is no
// longer "how much document" — that question is settled — and is now only
// which of the ten colour schemes from the design handoff to set it in.
//
// ⚠️ THE COLOURS AND THE SECTION SET ARE NOT RESTATED HERE. They are read out
// of motivation-pdf.service.ts, which is what actually draws the document. A
// picker holding its own copy of "#587068" would be right on the day it was
// written and wrong the first time somebody adjusted the palette — and the
// failure mode is the worst kind: a member picks a scheme, pays, and the PDF
// comes out in a different one. The catalogue is a VIEW over the renderer.
//
// ⚠️ THE PREVIEW IS NOT A PDF, AND THAT IS A HARD PRODUCT CONSTRAINT.
// Operator, 2026-08-19: "we must never open it in a window with a print option
// to prevent them printing to pdf." So this endpoint serves TOKENS — the
// eight scheme colours and which blocks the format shows — and the client
// draws a mock page out of them in the DOM. There is no document to print, no
// viewer toolbar, no download, and nothing on the wire that could be saved.
//
// Everything here is public product information: scheme names and a section
// list. No applicant data, so it is served without an id and cached.
// ────────────────────────────────────────────────────────────────────

export interface TemplateFormatOption {
  key: TemplateFormat;
  name: string;
  blurb: string;
  /** What the pack contains, for the comparison list. */
  includes: string[];
  lengthHint: string;
  /** Drives the mock page: which blocks the preview draws. */
  features: { contents: boolean; ownedTable: boolean; specBlock: boolean };
}

export interface TemplateSchemeOption extends SchemeColours {
  key: Scheme;
  name: string;
}

/**
 * One layout, as the picker and the preview need it.
 *
 * ⚠️ TOKENS, NOT A RENDERED PAGE — the same hard constraint the whole
 * catalogue is built on. Operator, 2026-08-19: "we must never open it in a
 * window with a print option to prevent them printing to pdf." So the preview
 * is drawn in the DOM from these, and there is no document on the wire that
 * could be saved.
 */
export interface TemplateLayoutOption {
  key: TemplateLayout;
  name: string;
  blurb: string;
  cover: string;
  heading: string;
  bodyFace: 'serif' | 'sans';
  runningBanner: boolean;
  hangingRule: boolean;
}

/**
 * ⚠️ DESCRIBES STRUCTURE, NEVER STRENGTH. The pack contains sections; it does
 * not contain a better argument or a better chance. Writing "the strongest
 * option" here would be an outcome claim on a product that never makes one,
 * and it would also be false — the same facts make the same case however the
 * document is set.
 */
const FORMAT_COPY: Record<
  TemplateFormat,
  { name: string; blurb: string; includes: string[]; lengthHint: string }
> = {
  comprehensive: {
    name: 'Full motivation',
    blurb:
      'Cover, contents, the motivation itself, a specification sheet for the firearm, and your annexures.',
    includes: [
      'Cover page with your details and a photograph of the firearm',
      'Contents, and the motivation set out in numbered sections',
      'Specification sheet — calibre, action, barrel, capacity, mass',
      'Table of the firearms already licensed to you',
      'Annexure index, and your documents reprinted with stamp blocks',
      'Request for prior notice and written reasons',
      'A two-page checklist of what to take to the DFO, at the back',
    ],
    lengthHint: 'Runs to the length your answers and annexures need',
  },
};

/**
 * Scheme names, and only names.
 *
 * No "professional", no "authoritative". A reviewing officer does not read a
 * document differently because it is Eucalyptus, and telling a member
 * otherwise would be selling them something that is not there.
 */
const SCHEME_NAMES: Record<Scheme, string> = {
  eucalyptus: 'Eucalyptus',
  slate: 'Slate',
  stone: 'Stone',
  sage: 'Sage',
  fogblue: 'Fog Blue',
  clay: 'Clay',
  olive: 'Olive',
  sand: 'Sand',
  graphite: 'Graphite',
  mauve: 'Mauve',
};

export interface TemplateCatalogue {
  formats: TemplateFormatOption[];
  /**
   * Named `colours` on the wire because that is what the client already calls
   * them; renaming the field would have been a client change for no gain.
   */
  colours: TemplateSchemeOption[];
  /**
   * The five ways the same document can be set.
   *
   * ⚠️ A SEPARATE AXIS FROM `colours`, and the picker must present it as one.
   * Fifty combinations, none of them special: a layout says WHERE the ink
   * goes, a scheme says WHICH ink. It is also NOT the retired concise/standard
   * axis returning — every layout carries every section.
   */
  layouts: TemplateLayoutOption[];
  defaults: {
    format: TemplateFormat;
    colourway: Scheme;
    layout: TemplateLayout;
  };
}

export function templateCatalogue(): TemplateCatalogue {
  return {
    formats: FORMAT_KEYS.map((key) => ({
      key,
      ...FORMAT_COPY[key],
      features: FORMAT_FEATURES[key],
    })),
    colours: SCHEME_KEYS.map((key) => ({
      key,
      name: SCHEME_NAMES[key],
      ...SCHEMES[key],
    })),
    // ⚠️ MUST MATCH asFormat/asScheme in the renderer, which fall back to
    // exactly these — a picker opening on anything else would show a member a
    // selection their document does not have.
    layouts: LAYOUT_KEYS.map((key) => ({
      key,
      name: LAYOUTS[key].name,
      blurb: LAYOUTS[key].blurb,
      // The tokens the client needs to DRAW the mock page, so the preview can
      // differ per layout without the client knowing how a PDF is built.
      cover: LAYOUTS[key].cover,
      heading: LAYOUTS[key].heading,
      bodyFace: LAYOUTS[key].bodyFace,
      runningBanner: LAYOUTS[key].runningBanner,
      hangingRule: LAYOUTS[key].hangingRule,
    })),
    defaults: {
      format: 'comprehensive',
      colourway: DEFAULT_SCHEME,
      layout: DEFAULT_LAYOUT,
    },
  };
}
