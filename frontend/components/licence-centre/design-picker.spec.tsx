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
// ⚠️ TWO WAYS THIS GOES WRONG QUIETLY, AND BOTH ARE PINNED BELOW. It can cost
// the box a document render for every member who loads the sheet and never
// opens the card; and it can leak a whole PDF per swatch, because five blob
// URLs are replaced on every colour change and nothing else revokes them.
// Neither shows up on screen.
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
const designSampleBlobUrl = vi.fn();
const setTemplate = vi.fn();

vi.mock('@/lib/motivations-api', () => ({
  motivationsApi: {
    templates: (...a: unknown[]) => templates(...a),
    designSampleBlobUrl: (...a: unknown[]) => designSampleBlobUrl(...a),
    setTemplate: (...a: unknown[]) => setTemplate(...a),
  },
}));

let created = 0;
const revoked: string[] = [];
Object.defineProperty(URL, 'createObjectURL', {
  writable: true,
  value: () => `blob:sample-${++created}`,
});
Object.defineProperty(URL, 'revokeObjectURL', {
  writable: true,
  value: (u: string) => revoked.push(u),
});

afterEach(() => {
  vi.clearAllMocks();
  revoked.length = 0;
  created = 0;
});

function setup() {
  templates.mockResolvedValue({ layouts: LAYOUTS, colours: COLOURS, formats: [] });
  designSampleBlobUrl.mockImplementation(
    async (_t: unknown, _id: string, c: { layout: string; colourway: string }) =>
      `blob:${c.layout}-${c.colourway}`,
  );
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

describe('the design card', () => {
  it('⚠️ COSTS NOTHING UNTIL IT IS OPENED', async () => {
    setup();
    await screen.findByText('Design');
    // Every member loading the sheet reaches this. Rendering five documents for
    // somebody who never looks at them is a bill and a busy box, both invisible.
    await waitFor(() => expect(templates).toHaveBeenCalled());
    expect(designSampleBlobUrl).not.toHaveBeenCalled();
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
    await waitFor(() => expect(designSampleBlobUrl).toHaveBeenCalledTimes(3));
    const asked = designSampleBlobUrl.mock.calls.map((c) => c[2].layout).sort();
    expect(asked).toEqual(['banner', 'classic', 'plate']);
  });

  it('⚠️ REVOKES THE OLD BLOBS WHEN THE COLOUR CHANGES', async () => {
    setup();
    await userEvent.click(await screen.findByText('Change'));
    await waitFor(() => expect(designSampleBlobUrl).toHaveBeenCalledTimes(3));

    await userEvent.click(screen.getByLabelText('Petrol'));
    await waitFor(() => expect(designSampleBlobUrl).toHaveBeenCalledTimes(6));

    // Three PDFs held in memory per swatch, and thirteen swatches to drag
    // along. Nothing on screen would ever show this going wrong.
    await waitFor(() =>
      expect(revoked).toEqual(
        expect.arrayContaining([
          'blob:banner-alloutdoor',
          'blob:plate-alloutdoor',
          'blob:classic-alloutdoor',
        ]),
      ),
    );
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
    designSampleBlobUrl.mockRejectedValue(new Error('down'));
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
