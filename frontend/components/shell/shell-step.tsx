'use client';

// The push header's second row: a step indicator with a progress track.
//
// The design puts this under the header on the two wizard surfaces — Sell and
// the Motivation Centre — and nowhere else. It is chrome, so it lives with the
// header rather than being re-drawn inside each wizard, but only the wizard
// knows which step it is on. So the page publishes its step and the header
// renders it.
//
// ⚠️ PUBLISHED FROM AN EFFECT, NOT DURING RENDER. Setting a parent's state
// while a child is rendering is a React error ("Cannot update a component while
// rendering a different component") and would loop. useShellStep() is a
// fire-and-forget declaration: call it with the current step and it keeps the
// header in sync, clearing itself when the wizard unmounts so the row does not
// linger on the next screen.
//
// The design shows both wizard boards reading "Step 3 of 5" with the track at
// 60%. That is placeholder data on a static artboard, not a spec — the real
// numbers come from whatever calls this.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ShellStep = {
  /** The step's own name, e.g. "Photos and description". */
  label: string;
  /** 1-based. */
  current: number;
  total: number;
};

type Ctx = {
  step: ShellStep | null;
  setStep: (s: ShellStep | null) => void;
};

const ShellStepContext = createContext<Ctx>({ step: null, setStep: () => {} });

export function ShellStepProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<ShellStep | null>(null);
  const value = useMemo(() => ({ step, setStep }), [step]);
  return (
    <ShellStepContext.Provider value={value}>
      {children}
    </ShellStepContext.Provider>
  );
}

/**
 * Publish the current wizard step to the shell header. Pass null to clear it.
 * Clears itself on unmount.
 */
export function useShellStep(step: ShellStep | null): void {
  const { setStep } = useContext(ShellStepContext);
  const { label, current, total } = step ?? { label: '', current: 0, total: 0 };

  useEffect(() => {
    setStep(label ? { label, current, total } : null);
    return () => setStep(null);
    // Depending on the primitives rather than the object means a caller can
    // build the object inline without re-firing this every render.
  }, [setStep, label, current, total]);
}

/** Read the published step. For the header only. */
export function useShellStepValue(): ShellStep | null {
  return useContext(ShellStepContext).step;
}

export function ShellStepRow() {
  const step = useShellStepValue();
  if (!step || step.total <= 0) return null;

  const pct = Math.max(
    0,
    Math.min(100, Math.round((step.current / step.total) * 100)),
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 16px',
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-primary)',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {step.label}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', flexShrink: 0 }}>
          Step {step.current} of {step.total}
        </span>
      </div>
      <div
        // The track is decorative; the text beside it already says where the
        // member is, so a second announcement would just repeat itself.
        aria-hidden
        style={{
          height: 5,
          borderRadius: 999,
          background: 'var(--bg-inset)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: 'var(--red)',
            transition: 'width var(--dur-base) var(--ease-out)',
          }}
        />
      </div>
    </div>
  );
}
