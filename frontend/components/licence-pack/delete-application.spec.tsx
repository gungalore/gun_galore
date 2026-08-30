// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DeleteApplication from './delete-application';

// ────────────────────────────────────────────────────────────────────
// THE ONE CONTROL THAT DESTROYS SOMETHING.
//
// Everything else in the wizard can be undone by typing a different answer.
// This deletes the row, the messages, the upload rows, and the encrypted
// files off our disk — the server calls it self-serve POPIA erasure and
// throttles it at five a minute for that reason.
//
// So the assertions here are about the two ways this hurts somebody: firing
// without a confirmation, and telling them the wrong thing about what they
// are losing.
// ────────────────────────────────────────────────────────────────────

const api = vi.hoisted(() => ({ erase: vi.fn() }));
const draft = vi.hoisted(() => ({ clearDraft: vi.fn() }));
const nav = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('@/lib/motivations-api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  motivationsApi: api,
}));
vi.mock('@/lib/motivation-draft', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  clearDraft: draft.clearDraft,
}));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

const base = {
  token: (async () => 't') as never,
  motivationId: 'mo-1',
  reference: 'MO000046',
};

beforeEach(() => vi.clearAllMocks());

describe('⚠️ it never fires on one click', () => {
  it('asks first, and erases nothing until it is confirmed', async () => {
    render(<DeleteApplication {...base} />);
    await userEvent.click(screen.getByRole('button', { name: /delete application/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(api.erase).not.toHaveBeenCalled();
  });

  it('backing out erases nothing', async () => {
    render(<DeleteApplication {...base} />);
    await userEvent.click(screen.getByRole('button', { name: /delete application/i }));
    await userEvent.click(screen.getByRole('button', { name: /keep it/i }));
    expect(api.erase).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('⚠️ THE DESTRUCTIVE BUTTON IS NOT THE DEFAULT ONE', () => {
    // A red primary button in a dialog people meet by mis-clicking is how
    // somebody loses an application they meant to keep.
    render(<DeleteApplication {...base} />);
    return userEvent
      .click(screen.getByRole('button', { name: /delete application/i }))
      .then(() => {
        const keep = screen.getByRole('button', { name: /keep it/i });
        const del = screen.getByRole('button', { name: /delete it/i });
        expect(
          keep.compareDocumentPosition(del) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      });
  });
});

describe('⚠️ what it tells them they are losing', () => {
  it('names the application, not "this item"', async () => {
    render(<DeleteApplication {...base} />);
    await userEvent.click(screen.getByRole('button', { name: /delete application/i }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/MO000046/);
  });

  it('says it cannot be undone', async () => {
    render(<DeleteApplication {...base} />);
    await userEvent.click(screen.getByRole('button', { name: /delete application/i }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/cannot be undone/i);
  });

  it('⚠️ SAYS THE DOCUMENT CENTRE SURVIVES', async () => {
    // erase() never touches `Credential`. A member who thinks deleting one
    // application wipes their Document Centre keeps an application they did
    // not want — the copy is what prevents that.
    render(<DeleteApplication {...base} />);
    await userEvent.click(screen.getByRole('button', { name: /delete application/i }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/Document Centre stays/i);
  });

  it('⚠️ WARNS THAT OTHER APPLICATIONS LOSE THE PREFILL', async () => {
    // Prior readings are pulled across ALL of a member's motivations, so
    // deleting one is also deleting documents that were quietly filling in
    // the others. That is the consequence nobody would guess.
    render(<DeleteApplication {...base} />);
    await userEvent.click(screen.getByRole('button', { name: /delete application/i }));
    expect(screen.getByRole('dialog')).toHaveTextContent(
      /not fill in your other applications/i,
    );
  });
});

describe('once confirmed', () => {
  it('⚠️ CLEARS THE LOCAL DRAFT AS WELL AS THE ROW', async () => {
    // The draft is keyed on the motivation id and the wizard PREFERS it over
    // the server's copy, so without this the answers come back on the next
    // application handed the same id. The old page learned this the hard way.
    api.erase.mockResolvedValue({ erased: true, filesRemoved: 2 });
    render(<DeleteApplication {...base} />);
    await userEvent.click(screen.getByRole('button', { name: /delete application/i }));
    await userEvent.click(screen.getByRole('button', { name: /delete it/i }));
    expect(api.erase).toHaveBeenCalledWith(base.token, 'mo-1');
    expect(draft.clearDraft).toHaveBeenCalledWith('mo-1');
  });

  it('goes to the Centre by default', async () => {
    api.erase.mockResolvedValue({ erased: true, filesRemoved: 0 });
    render(<DeleteApplication {...base} />);
    await userEvent.click(screen.getByRole('button', { name: /delete application/i }));
    await userEvent.click(screen.getByRole('button', { name: /delete it/i }));
    expect(nav.push).toHaveBeenCalledWith('/motivations');
  });

  it('⚠️ DEFERS TO onDeleted RATHER THAN NAVIGATING', async () => {
    // On the Centre we are already there — a push would look like nothing
    // happened while the deleted row sat on screen until the next load.
    api.erase.mockResolvedValue({ erased: true, filesRemoved: 0 });
    const onDeleted = vi.fn();
    render(<DeleteApplication {...base} onDeleted={onDeleted} />);
    await userEvent.click(screen.getByRole('button', { name: /delete application/i }));
    await userEvent.click(screen.getByRole('button', { name: /delete it/i }));
    expect(onDeleted).toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
  });
});

describe('when it fails', () => {
  it('keeps the dialog open, says why, and lets them try again', async () => {
    api.erase.mockRejectedValue(new Error('boom'));
    render(<DeleteApplication {...base} />);
    await userEvent.click(screen.getByRole('button', { name: /delete application/i }));
    await userEvent.click(screen.getByRole('button', { name: /delete it/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/could not delete it/i);
    expect(screen.getByRole('button', { name: /delete it/i })).toBeEnabled();
    // ⚠️ AND IT MUST NOT PRETEND IT WORKED. Navigating away from a failed
    // deletion leaves the application alive and the member believing it is
    // gone.
    expect(nav.push).not.toHaveBeenCalled();
    expect(draft.clearDraft).not.toHaveBeenCalled();
  });
});
