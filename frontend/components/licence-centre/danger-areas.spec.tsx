// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import DangerAreas from './danger-areas';
import type { DangerArea } from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// THE QUESTION THE APPLICANT CAN ACTUALLY ANSWER.
//
// Operator, 2026-09-08: "lets them just tick the ones they travel through with
// a reason thats optional for the reason being in that area."
//
// ⚠️ AND IT IS THE ONLY THING THAT CAN WRITE `press_clippings`. That key is
// internal, the wizard that wrote it was deleted in Phase 4, and the annexure
// has been unreachable ever since. A regression here is not a cosmetic one:
// it is a section 13 losing the evidence that its case rests on.
// ────────────────────────────────────────────────────────────────────

const area = (over: Partial<DangerArea> = {}): DangerArea => ({
  name: 'Edgemead',
  key: 'EDGEMEAD',
  incidentIds: ['i1'],
  count: 1,
  distanceKm: 19.1,
  crimeTypes: ['armed robbery'],
  latestHeadline: 'Man stabbed at intersection',
  latestOn: '2026-09-07',
  onRoute: false,
  station: { name: 'Milnerton', province: 'Western Cape' },
  ticked: false,
  ...over,
});

function mount(areas: DangerArea[], station: string | null = 'Kraaifontein') {
  const onSave = vi.fn();
  render(
    <DangerAreas
      areas={areas}
      station={station}
      withinKm={50}
      onSave={onSave}
    />,
  );
  return { onSave };
}

describe('the list', () => {
  it('names the area, what was reported, and whose station it is', () => {
    mount([area()]);
    expect(screen.getByText('Edgemead')).toBeTruthy();
    expect(
      screen.getByText(/1 report · armed robbery · 19 km away · Milnerton/),
    ).toBeTruthy();
  });

  it('⚠️ SHOWS THE HEADLINE, so a row is a fact and not a place name', () => {
    mount([area()]);
    expect(screen.getByText(/Man stabbed at intersection/)).toBeTruthy();
  });

  it('⚠️ SAYS NOTHING ABOUT A ROUTE UNTIL THERE IS ONE', () => {
    // `onRoute` is false on every area until the Maps work lands. A badge that
    // always says the same thing is a badge nobody reads.
    mount([area()]);
    expect(screen.queryByText('on your route')).toBeNull();
  });

  it('marks an area on the route once it is', () => {
    mount([area({ onRoute: true })]);
    expect(screen.getByText('on your route')).toBeTruthy();
  });
});

describe('ticking and the reason', () => {
  it('⚠️ THE REASON BOX APPEARS ONLY AFTER THE TICK', () => {
    // Eleven empty boxes down the page is a form; one box under the thing they
    // just said yes to is a question.
    mount([area()]);
    expect(screen.queryByPlaceholderText(/Why are you there/)).toBeNull();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByPlaceholderText(/Why are you there/)).toBeTruthy();
  });

  it('⚠️ SAVES A TICK WITH NO REASON, because the reason is optional', () => {
    const { onSave } = mount([area()]);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Save these areas'));
    expect(onSave).toHaveBeenCalledWith([{ key: 'EDGEMEAD' }]);
  });

  it('sends the reason when they give one', () => {
    const { onSave } = mount([area()]);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByPlaceholderText(/Why are you there/), {
      target: { value: '  my daughter’s school  ' },
    });
    fireEvent.click(screen.getByText('Save these areas'));
    expect(onSave).toHaveBeenCalledWith([
      { key: 'EDGEMEAD', reason: 'my daughter’s school' },
    ]);
  });

  it('⚠️ AN UNTICKED AREA IS REMOVED, not left behind with its reason', () => {
    const { onSave } = mount([area({ ticked: true, reason: 'work' })]);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Save these areas'));
    expect(onSave).toHaveBeenCalledWith([]);
  });

  it('seeds from what the server already holds', () => {
    mount([area({ ticked: true, reason: 'work run' })]);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect(
      (screen.getByPlaceholderText(/Why are you there/) as HTMLInputElement).value,
    ).toBe('work run');
  });

  it('counts what is ticked', () => {
    mount([area(), area({ key: 'DUNOON', name: 'Dunoon' })]);
    expect(screen.getByText('None ticked')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(screen.getByText('1 area ticked')).toBeTruthy();
  });
});

describe('when there is nothing to show', () => {
  it('⚠️ EXPLAINS ITSELF RATHER THAN RENDERING NOTHING', () => {
    // A section that renders nothing is indistinguishable from one that is
    // broken, and this depends on a station, a geocoder and twelve months of
    // somebody else's RSS.
    mount([], 'Kraaifontein');
    expect(
      screen.getByText(/no crime reporting within 50 km of Kraaifontein/),
    ).toBeTruthy();
  });

  it('asks for the station when that is what is missing', () => {
    mount([], null);
    expect(screen.getByText(/Tell us your nearest police station/)).toBeTruthy();
  });
});
