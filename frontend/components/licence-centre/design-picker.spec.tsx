// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DesignPicker from './design-picker';

// ────────────────────────────────────────────────────────────────────
// THE DESIGN CARD.
//
// Operator, 2026-09-10: "Can we give them mock ups of each template which costs
// nothing ... Call it Design."
//
// ⚠️ IT SHIPPED BROKEN ONCE AND NOTHING SAID SO. The samples were PDFs in
// iframes: perfect on desktop Chrome, five empty boxes on the operator's phone,
// because iOS renders no PDF in an iframe and fails silently. They are canvases
// now. What is pinned below is the cost — a document render, and a third of a
// megabyte of pdf.js, must not be spent on somebody who never opens the card.
// ────────────────────────────────────────────────────────────────────

const LAYOUTS = [
  { key: 'banner', name: 'Banner', blurb: 'A deep colour banner.' },
  { key: 'plate', name: 'Plate', blurb: 'A centred title plate.' },
  { key: 'classic', name: 'Classic', blurb: 'Plain and formal.' },
];
const COLOURS = [
  { key: 'alloutdoor', name: 'All Outdoor', accent: '#C8102E', bannerTo: '#e7e3d9' },
  { key: 'petrol', name: 'Petrol', accent: '#298e9a', bannerTo: '#95a7aa' },
];

const templates = vi.fn();
const designSampleBytes = vi.fn();
const setTemplate = vi.fn();

vi.mock('@/lib/motivations-api', () => ({
  motivationsApi: {
    templates: (...a: unknown[]) => templates(...a),
    designSampleBytes: (...a: unknown[]) => designSampleBytes(...a),
    setTemplate: (...a: unknown[]) => setTemplate(...a),
  },
}));

/**
 * ⚠️ WHAT THESE CANNOT COVER, SAID OUT LOUD. jsdom has no canvas, so the
 * pdf.js rasterisation these tests trigger always fails and is always swallowed
 * — every assertion below is about the FETCHING and the SAVING, never about a
 * picture appearing. The thing that broke on the operator's phone lives in the
 * half no unit test on this stack can reach, so it is verified in a real
 * browser at a real viewport and nowhere else. Do not read a green run here as
 * "the thumbnails render".
 */
afterEach(() => {
  vi.clearAllMocks();
});

function setup() {
  templates.mockResolvedValue({ layouts: LAYOUTS, colours: COLOURS, formats: [] });
  designSampleBytes.mockResolvedValue(new ArrayBuffer(8));
  setTemplate.mockResolvedValue({});
  return render(
    <DesignPicker
      token={async () => 'tok'}
      motivationId="mo-1"
      layout={null}
      colourway={null}
    />,
  );
}

import pkg from '../../package.json';
import { readdirSync } from 'node:fs';

describe('the pdf.js worker', () => {
  it('⚠️ IS SHIPPED, AT A PATH THAT MATCHES THE INSTALLED VERSION', () => {
    // pdf.js refuses to run against a worker built from another version, and
    // the failure is at runtime on a member's phone with a clean build. The
    // first attempt shipped with no worker at all: every sample failed, every
    // card was empty, and desktop testing could not have caught it either.
    const installed = pkg.dependencies['pdfjs-dist'].replace(/^[^0-9]*/, '');
    const shipped = readdirSync('public/pdfjs');
    expect(shipped).toContain(installed);
    expect(readdirSync(`public/pdfjs/${installed}`)).toContain(
      'pdf.worker.min.mjs',
    );
  });
});

describe('the design card', () => {
  it('⚠️ COSTS NOTHING UNTIL IT IS OPENED', async () => {
    setup();
    await screen.findByText('Design');
    // Every member loading the sheet reaches this. Rendering five documents for
    // somebody who never looks at them is a bill and a busy box, both invisible.
    await waitFor(() => expect(templates).toHaveBeenCalled());
    expect(designSampleBytes).not.toHaveBeenCalled();
  });

  it('says plainly that it changes nothing about the document', async () => {
    setup();
    // The renderer pins that every layout carries every section. Somebody
    // choosing a colour must not be left wondering whether they weakened
    // their own application.
    expect(
      await screen.findByText(/changes nothing about what it says/i),
    ).toBeTruthy();
  });

  it('draws one real sample per layout once opened', async () => {
    setup();
    await userEvent.click(await screen.findByText('Change'));
    await waitFor(() => expect(designSampleBytes).toHaveBeenCalledTimes(3));
    const asked = designSampleBytes.mock.calls.map((c) => c[2].layout).sort();
    expect(asked).toEqual(['banner', 'classic', 'plate']);
  });

  it('saves the choice without blocking on it', async () => {
    setup();
    await userEvent.click(await screen.findByText('Change'));
    await screen.findByText('Plate');

    await userEvent.click(screen.getByLabelText('Petrol'));
    expect(setTemplate).toHaveBeenCalledWith(expect.anything(), 'mo-1', {
      colourway: 'petrol',
    });

    await userEvent.click(screen.getByText('Plate'));
    expect(setTemplate).toHaveBeenCalledWith(expect.anything(), 'mo-1', {
      layout: 'plate',
    });
  });

  it('⚠️ ONE AXIS AT A TIME, so a colour never resets the layout', async () => {
    // The server reads an absent field as "leave it alone". Sending both every
    // time would make a colour click overwrite a layout the member chose.
    setup();
    await userEvent.click(await screen.findByText('Change'));
    await screen.findByText('Plate');
    await userEvent.click(screen.getByLabelText('Petrol'));
    expect(setTemplate.mock.calls[0][2]).not.toHaveProperty('layout');
  });

  it('survives a sample that will not draw', async () => {
    templates.mockResolvedValue({ layouts: LAYOUTS, colours: COLOURS, formats: [] });
    designSampleBytes.mockRejectedValue(new Error('down'));
    setTemplate.mockResolvedValue({});
    render(
      <DesignPicker
        token={async () => 'tok'}
        motivationId="mo-1"
        layout={null}
        colourway={null}
      />,
    );
    await userEvent.click(await screen.findByText('Change'));
    // The choice still saves and the card still works — a preview that cannot
    // draw must not take the document with it.
    expect(await screen.findByText(/could not draw the samples/i)).toBeTruthy();
    await userEvent.click(screen.getByText('Plate'));
    expect(setTemplate).toHaveBeenCalled();
  });
});
