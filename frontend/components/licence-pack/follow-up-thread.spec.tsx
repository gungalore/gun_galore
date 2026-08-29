// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FollowUpThread from './follow-up-thread';
import type { FollowUp } from '@/lib/motivations-api';

// The rules are tested in lib/follow-up-rules.spec.ts. These assert the panel
// obeys them, and that a member cannot spend the one irreversible gesture —
// answering marks the field MEMBER for good — on nothing.

let n = 0;
const msg = (over: Partial<FollowUp>): FollowUp => ({
  id: `m${n++}`,
  role: 'assistant',
  content: 'What does a normal week look like?',
  fieldKey: 'daily_movements',
  fieldLabel: 'Your daily movements',
  createdAt: new Date().toISOString(),
  ...over,
});

describe('nothing outstanding', () => {
  it('renders nothing at all', () => {
    const { container } = render(
      <FollowUpThread messages={[]} onAnswer={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing once every question is answered', () => {
    const { container } = render(
      <FollowUpThread
        messages={[msg({}), msg({ role: 'user', content: 'I commute daily' })]}
        onAnswer={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('an open question', () => {
  it('shows the question, its field, and why it is being asked', () => {
    render(<FollowUpThread messages={[msg({})]} onAnswer={vi.fn()} />);
    expect(screen.getByText(/normal week/i)).toBeInTheDocument();
    expect(screen.getByText('Your daily movements')).toBeInTheDocument();
    // ⚠️ SAYS WHY WITHOUT BLAME — too short to build from, not wrong.
    expect(screen.getByText(/too short for us to build/i)).toBeInTheDocument();
  });

  it('⚠️ SAYS THE PACK CANNOT BE WRITTEN UNTIL IT IS ANSWERED', () => {
    // The whole reason this panel is a blocker rather than a nicety.
    render(<FollowUpThread messages={[msg({})]} onAnswer={vi.fn()} />);
    expect(screen.getByText(/cannot be written until/i)).toBeInTheDocument();
  });

  it('gives each question its own box', () => {
    render(
      <FollowUpThread
        messages={[msg({}), msg({ fieldKey: 'threat_circumstances', fieldLabel: 'Threat' })]}
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
  });
});

describe('⚠️ answering is irreversible, so it cannot be spent on nothing', () => {
  it('will not submit whitespace', async () => {
    // Submitting marks the field MEMBER — locking it against every prefill
    // source — in exchange for nothing.
    const onAnswer = vi.fn();
    render(<FollowUpThread messages={[msg({})]} onAnswer={onAnswer} />);
    const button = screen.getByRole('button', { name: /answer/i });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox'), '   ');
    expect(button).toBeDisabled();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('submits the trimmed answer against the right message', async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    const q = msg({ id: 'msg-7' });
    render(<FollowUpThread messages={[q]} onAnswer={onAnswer} />);
    await userEvent.type(screen.getByRole('textbox'), '  I travel at night  ');
    await userEvent.click(screen.getByRole('button', { name: /answer/i }));
    expect(onAnswer).toHaveBeenCalledWith('msg-7', 'I travel at night');
  });
});
