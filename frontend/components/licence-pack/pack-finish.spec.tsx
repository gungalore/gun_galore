// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PackFinish from './pack-finish';

// ────────────────────────────────────────────────────────────────────
// THE END OF THE WIZARD, WHICH DID NOT EXIST.
//
// The rebuilt wizard's last button was `router.push('/motivations/${id}')` — a
// bare navigation dressed as an action, and the clearest single proof it could
// not stand alone. These assert the four states it now has, because each shows
// something different and getting one wrong strands a member at the end of
// eleven steps.
// ────────────────────────────────────────────────────────────────────

const api = vi.hoisted(() => ({
  acceptDeclaration: vi.fn(),
  generate: vi.fn(),
  get: vi.fn(),
  pdfBlobUrl: vi.fn(),
  saps271BlobUrl: vi.fn(),
}));

vi.mock('@/lib/motivations-api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  motivationsApi: api,
}));

const base = {
  token: (async () => 't') as never,
  motivationId: 'mo-1',
  reference: 'MO000039',
  outstanding: [] as string[],
  saps271Filled: false,
  onStatus: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('⚠️ still missing answers', () => {
  it('does not offer to write it, and says how many are left', () => {
    // Generating with required answers missing spends a model run on a
    // document the member cannot file.
    render(<PackFinish {...base} status="DRAFT" outstanding={['a', 'b']} />);
    expect(screen.getByText(/2 answers still to give/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /write my motivation/i }),
    ).not.toBeInTheDocument();
  });

  it('⚠️ NAMES THE COUNT RATHER THAN JUST REFUSING', () => {
    // "You cannot continue" without saying what is outstanding is the dead
    // end the old page had to fix — the member is looking at a form where
    // everything visible is filled in.
    render(<PackFinish {...base} status="DRAFT" outstanding={['a']} />);
    expect(screen.getByText(/1 answer still to give/i)).toBeInTheDocument();
    expect(screen.getByText(/steps above show which/i)).toBeInTheDocument();
  });
});

describe('ready to write', () => {
  it('⚠️ THE DECLARATION IS MADE BY CONTINUING, NOT BY A TICK', () => {
    // The only checkbox is the OPTIONAL testimonial consent. A required
    // "I declare" tick would imply the declaration is ours to gate rather
    // than their statement under s120(9)(f).
    render(<PackFinish {...base} status="DRAFT" />);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(1);
    expect(screen.getByText(/ask me later how my application went/i)).toBeInTheDocument();
    expect(screen.getByText(/everything you have told us is true/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /write my motivation/i })).toBeEnabled();
  });

  it('accepts the declaration before it generates, and passes the consent', async () => {
    api.acceptDeclaration.mockResolvedValue({});
    api.generate.mockResolvedValue({});
    api.get.mockResolvedValue({ status: 'COMPLETED' });

    render(<PackFinish {...base} status="DRAFT" />);
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: /write my motivation/i }));

    expect(api.acceptDeclaration).toHaveBeenCalledWith(base.token, 'mo-1', true);
    expect(api.generate).toHaveBeenCalled();
  });

  it('reports the finished status upward', async () => {
    api.acceptDeclaration.mockResolvedValue({});
    api.generate.mockResolvedValue({});
    api.get.mockResolvedValue({ status: 'COMPLETED' });
    const onStatus = vi.fn();

    render(<PackFinish {...base} status="DRAFT" onStatus={onStatus} />);
    await userEvent.click(screen.getByRole('button', { name: /write my motivation/i }));
    expect(onStatus).toHaveBeenCalledWith('COMPLETED');
  });
});

describe('while it is being written', () => {
  it('⚠️ TELLS THEM THEY MAY LEAVE', () => {
    // A generation runs for minutes behind a sixty-second proxy. Somebody
    // watching a button instead of closing the tab is the failure this copy
    // exists to prevent — and the SMS it promises is now actually sent.
    render(<PackFinish {...base} status="GENERATING" />);
    const msg = screen.getByRole('status');
    expect(msg.textContent).toMatch(/you can leave this page/i);
    expect(msg.textContent).toMatch(/SMS and an email/i);
    expect(
      screen.queryByRole('button', { name: /write my motivation/i }),
    ).not.toBeInTheDocument();
  });
});

describe('once it is done', () => {
  it('offers the motivation', () => {
    render(<PackFinish {...base} status="COMPLETED" />);
    expect(screen.getByRole('button', { name: /open your motivation/i })).toBeInTheDocument();
  });

  it('⚠️ OFFERS THE SAPS 271 ONLY WHERE WE WERE ASKED TO FILL IT', () => {
    // A button for a form we were never asked to produce is a button that
    // 404s at the moment the member most needs it to work.
    render(<PackFinish {...base} status="COMPLETED" saps271Filled={false} />);
    expect(screen.queryByRole('button', { name: /saps 271/i })).not.toBeInTheDocument();
  });

  it('offers it when they did ask', () => {
    render(<PackFinish {...base} status="COMPLETED" saps271Filled />);
    expect(screen.getByRole('button', { name: /saps 271/i })).toBeInTheDocument();
  });

  it('does not still offer to write it', () => {
    render(<PackFinish {...base} status="COMPLETED" />);
    expect(
      screen.queryByRole('button', { name: /write my motivation/i }),
    ).not.toBeInTheDocument();
  });
});
