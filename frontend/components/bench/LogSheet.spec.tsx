// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import LogSheet from './LogSheet';
import type { CartridgeHead, LoadRow } from '@/lib/bench/api';

/**
 * THE BENCH — what the log sheet makes of what was typed.
 *
 * 🚨 `35,6` USED TO BE LOGGED AS `35.0 gr`. parseFloat stops at a decimal
 * comma, and this site writes its own cartridge names with one — `6,5
 * Creedmoor` — so the separator a member reaches for is the one that silently
 * truncated their charge by half a grain, saved it, and showed it back as
 * though it were what they had asked for.
 *
 * ⚠️ AND SAVE IS ONLY EVER DISABLED BY A VALUE THE SERVER CANNOT STORE. Every
 * flag on this sheet warns and none of them block: a work-up that walks past
 * the max charge is a legitimate thing to record, and a log that refuses it is
 * a log someone keeps somewhere else.
 */

const ROW: LoadRow = {
  id: 'row-1',
  bulletMaker: 'Hornady',
  bulletType: 'ELD Match',
  powder: 'H4350',
  startGr: 35.6,
  startFps: 2400,
  maxGr: 41.5,
  maxFps: 2700,
  coalMm: null,
  coalLoMm: null,
  coalHiMm: null,
  flags: [],
};

const CARTRIDGE: CartridgeHead = {
  key: '6-5-creedmoor',
  name: '6,5 Creedmoor',
  maxLengthMm: 71.76,
  pmaxBar: 4350,
  pmaxPsi: 63092,
  thumb: null,
};

function sheet(onSave = vi.fn()) {
  render(
    <LogSheet
      units="metric"
      row={ROW}
      cartridge={CARTRIDGE}
      weightGr={140}
      saving={false}
      error={null}
      onClose={() => {}}
      onSave={onSave}
    />,
  );
  return {
    onSave,
    charge: screen.getByLabelText('Charge, gr'),
    coal: screen.getByLabelText('COAL, mm'),
    save: screen.getByRole('button', { name: 'Save to load log' }),
  };
}

describe('a decimal comma is a decimal point', () => {
  it('logs 35,6 as 35.6 grains', () => {
    const s = sheet();
    fireEvent.change(s.charge, { target: { value: '35,6' } });
    fireEvent.click(s.save);
    expect(s.onSave).toHaveBeenCalledTimes(1);
    expect(s.onSave.mock.calls[0][0].chargeGr).toBe(35.6);
  });

  it('leaves what the member typed exactly where they typed it', () => {
    const s = sheet();
    fireEvent.change(s.charge, { target: { value: '35,6' } });
    expect((s.charge as HTMLInputElement).value).toBe('35,6');
  });

  it('says back what the figure was read as', () => {
    const s = sheet();
    fireEvent.change(s.charge, { target: { value: '35,6' } });
    expect(screen.getByText('reads as 35.6 gr')).toBeInTheDocument();
  });

  it('does not clutter a figure typed with a point', () => {
    const s = sheet();
    fireEvent.change(s.charge, { target: { value: '35.6' } });
    expect(screen.queryByText(/reads as/)).toBeNull();
  });

  it('reads a COAL the same way, and flags it the same way', () => {
    const s = sheet();
    fireEvent.change(s.coal, { target: { value: '71,63' } });
    expect(screen.getByText('COAL −0.13 MAX')).toBeInTheDocument();
    expect(screen.getByText('reads as 71.63 mm')).toBeInTheDocument();
  });
});

describe('Save waits for a number the server can store', () => {
  it('is disabled on words', () => {
    const s = sheet();
    fireEvent.change(s.charge, { target: { value: 'abc' } });
    expect(s.save).toBeDisabled();
  });

  it('is disabled on an empty charge', () => {
    const s = sheet();
    fireEvent.change(s.charge, { target: { value: '' } });
    expect(s.save).toBeDisabled();
  });

  it('is disabled on zero', () => {
    const s = sheet();
    fireEvent.change(s.charge, { target: { value: '0' } });
    expect(s.save).toBeDisabled();
  });

  /**
   * ⚠️ A GROUPED FIGURE IS NOT A DECIMAL COMMA, AND GUESSING IS WORSE THAN
   * ASKING. `1,234.5` with every comma swapped for a point becomes `1.234.5`,
   * which parseFloat reads as `1.234` — the same silent truncation the comma
   * fix exists to kill. It comes back NaN instead, and Save waits.
   */
  it('is disabled on a grouped figure rather than guessing at it', () => {
    const s = sheet();
    fireEvent.change(s.charge, { target: { value: '1,234.5' } });
    expect(s.save).toBeDisabled();
  });

  it('is disabled on a date that is not a calendar day', () => {
    const s = sheet();
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-02-31' } });
    expect(s.save).toBeDisabled();
  });

  it('is enabled again the moment the figure is a number', () => {
    const s = sheet();
    fireEvent.change(s.charge, { target: { value: 'abc' } });
    fireEvent.change(s.charge, { target: { value: '38,2' } });
    expect(s.save).toBeEnabled();
  });
});

describe('an implausible charge is louder than an overrun', () => {
  it('names the multiple when the charge is past half again the max', () => {
    const s = sheet();
    fireEvent.change(s.charge, { target: { value: '356' } });
    expect(screen.getByText('CHECK THIS CHARGE · 8.6× the max')).toBeInTheDocument();
    expect(screen.getByText('ABOVE MAX 41.5')).toBeInTheDocument();
  });

  /** 🚨 IT WARNS. IT DOES NOT BLOCK — the whole log depends on that. */
  it('still lets it be saved', () => {
    const s = sheet();
    fireEvent.change(s.charge, { target: { value: '356' } });
    expect(s.save).toBeEnabled();
    fireEvent.click(s.save);
    expect(s.onSave.mock.calls[0][0].chargeGr).toBe(356);
  });

  it('leaves a 0.2 gr overrun with the quiet tag it had', () => {
    const s = sheet();
    fireEvent.change(s.charge, { target: { value: '41,7' } });
    expect(screen.getByText('ABOVE MAX 41.5')).toBeInTheDocument();
    expect(screen.queryByText(/CHECK THIS CHARGE/)).toBeNull();
  });

  it('keeps BELOW START as it was', () => {
    const s = sheet();
    fireEvent.change(s.charge, { target: { value: '30' } });
    expect(screen.getByText('BELOW START 35.6')).toBeInTheDocument();
  });
});
