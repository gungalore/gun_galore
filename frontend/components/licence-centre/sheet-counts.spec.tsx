// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SheetHeader from './sheet-header';
import SheetFooter from './sheet-footer';
import { sheet } from './__fixtures__/sheet.fixture';

// ────────────────────────────────────────────────────────────────────
// ONE NUMBER, THREE VIEWS, AND THEY MUST NEVER DISAGREE.
//
// ⚠️ THIS SUITE EXISTS BECAUSE THE SCREEN IT REPLACES HAD FOUR PROGRESS
// SYSTEMS. The rail ticked steps, the footer counted answers, the right-hand
// panel gave per-letter percentages, and the pack step listed chips — and the
// live walkthrough caught two of them contradicting each other outright: the
// Declarations step carried a green tick from the moment the application
// opened while its own panel read "H Declarations 0%".
//
// The progress pill, the chip dots and the footer all derive from the SAME
// server-supplied `missing` list. These cases pin that they agree for every
// shape of it.
// ────────────────────────────────────────────────────────────────────

/** The three views, rendered together off one `missing` list. */
function renderBoth(missing: string[]) {
  const s = sheet({ missing });
  const sections = s.sections.map((sec) => ({
    id: sec.id,
    label: sec.title,
    missing: sec.missing.length,
  }));
  return render(
    <>
      <SheetHeader
        reference={s.application.referenceNumber}
        licenceType={s.application.licenceTypeLabel}
        missingCount={missing.length}
        sections={sections}
        active="firearm"
        previewOpen={false}
        onTogglePreview={vi.fn()}
      />
      <SheetFooter missingCount={missing.length} onWrite={vi.fn()} />
    </>,
  );
}

describe('the three views agree', () => {
  it('nothing outstanding — ready, and the last thing asked is the declaration', () => {
    renderBoth([]);
    expect(screen.getByText('Ready to write')).toBeDefined();
    const button = screen.getByRole('button', {
      name: 'Write my motivation',
    }) as HTMLButtonElement;
    /**
     * ⚠️ THE BUTTON IS STILL SHUT, AND IT IS NOT THE COUNT DOING IT. `generate`
     * refuses with a 409 until the declaration is accepted — a gate that has
     * always existed behind a wizard screen Phase 4 deleted, so the sheet
     * enabled the button and the click failed silently. The footer asks here
     * now, so the three views still agree about the COUNT and the button says
     * what it is actually waiting for.
     */
    expect(button.disabled).toBe(true);
    expect(document.body.textContent).not.toContain('still needed above');
    expect(document.body.textContent).toContain('Tick the declaration');
  });

  it('and opens the moment the declaration is ticked', () => {
    renderBoth([]);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(
      (screen.getByRole('button', {
        name: 'Write my motivation',
      }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('one outstanding — singular, and the button is blocked', () => {
    renderBoth(['firearm_calibre']);
    expect(screen.getByText('1 thing left')).toBeDefined();
    expect(screen.getByText('1 thing still needed above')).toBeDefined();
    expect(
      (screen.getByRole('button', { name: 'Write my motivation' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('several outstanding — plural, and the two counts match', () => {
    renderBoth(['a', 'b', 'c']);
    expect(screen.getByText('3 things left')).toBeDefined();
    expect(screen.getByText('3 things still needed above')).toBeDefined();
  });

  it('⚠️ NEVER SAYS "0 things still needed" — a finished footer is silent', () => {
    renderBoth([]);
    expect(document.body.textContent).not.toContain('0 thing');
  });
});

describe('the section chips', () => {
  it('anchor to their section, so a tap lands under the strip', () => {
    renderBoth([]);
    // Exact, not a regex: "Firearms you own" also contains "Firearm", and a
    // loose matcher here would pass against the wrong chip.
    const chip = screen.getByRole('link', { name: 'The firearm' });
    expect(chip.getAttribute('href')).toBe('#firearm');
  });

  it('marks the active section, and only that one', () => {
    const s = sheet();
    render(
      <SheetHeader
        reference="MO000066"
        licenceType="Section 16"
        missingCount={0}
        sections={s.sections.map((sec) => ({
          id: sec.id,
          label: sec.title,
          missing: 0,
        }))}
        active="premises"
        previewOpen={false}
        onTogglePreview={vi.fn()}
      />,
    );
    const active = screen
      .getAllByRole('link')
      .filter((a) => a.className.includes('--red'));
    expect(active).toHaveLength(1);
    expect(active[0].getAttribute('href')).toBe('#premises');
  });
});

describe('the preview toggle', () => {
  it('reports its state, so it can be read back', () => {
    const s = sheet();
    render(
      <SheetHeader
        reference="MO000066"
        licenceType="Section 16"
        missingCount={0}
        sections={s.sections.map((sec) => ({
          id: sec.id,
          label: sec.title,
          missing: 0,
        }))}
        active="firearm"
        previewOpen
        onTogglePreview={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: /Preview/ }).getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
