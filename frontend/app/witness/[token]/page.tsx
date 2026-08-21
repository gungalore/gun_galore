'use client';

import { use, useCallback, useEffect, useState } from 'react';
import WitnessStepper from '@/components/witness-stepper';
import WitnessSignaturePad from '@/components/witness-signature-pad';

// ────────────────────────────────────────────────────────────────────
// THE WITNESS'S FIVE SCREENS.
//
// Operator, 2026-08-21: "do it in a few screen steps, like the NATshoot sign
// up I sent style" — a numbered rail across the top, one card at a time.
//
// ⚠️ THIS PAGE IS OPENED BY A STRANGER WHO DID NOT ASK FOR IT. They received an
// SMS from somebody applying for a firearm licence. Everything here is shaped
// by that: it says who is asking and why in the first sentence, it never asks
// for anything it has not explained, it tells them their answers go to the
// applicant and to nobody else by us, and it says plainly that "No" is an
// answer. A form that reads like a phishing page is one a sensible person
// closes — and they would be right to.
//
// ⚠️ NOTHING IS SAVED UNTIL THEY SIGN. The whole statement posts once, at the
// end, with the signature. A part-saved statement is not the witness's word on
// anything, and it would let an applicant read a half-answer and lean on
// somebody mid-form.
// ────────────────────────────────────────────────────────────────────

const API =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const STEPS = [
  { key: 'otp', label: 'Verify' },
  { key: 'welcome', label: 'About this' },
  { key: 'about', label: 'About you' },
  { key: 'questions', label: 'Questions' },
  { key: 'sign', label: 'Sign' },
] as const;

interface Field {
  key: string;
  label: string;
  kind: string;
  hint?: string;
  required: boolean;
  maxLength: number;
  choices?: string[];
}
interface Declaration {
  key: string;
  number: string;
  text: string;
  cite: string;
}
interface OpenState {
  status: string;
  invitedName: string;
  phoneHint: string;
  applicantName: string;
  licenceTypeLabel: string;
  notices: string[];
  fields: Field[];
  declarations: Declaration[];
  answerOptions: string[];
  version: string;
}

export default function WitnessPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [state, setState] = useState<OpenState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});

  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [signature, setSignature] = useState<string | null>(null);
  const [place, setPlace] = useState('');
  const [locating, setLocating] = useState(false);
  const [done, setDone] = useState(false);

  const post = useCallback(
    async (path: string, body?: unknown) => {
      const res = await fetch(`${API}/witness/${token}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(
          (Array.isArray(data?.message) ? data.message.join(' ') : data?.message) ??
            'Something went wrong. Please try again.',
        ) as Error & { problems?: Record<string, string> };
        err.problems = data?.problems;
        throw err;
      }
      return data;
    },
    [token],
  );

  useEffect(() => {
    (async () => {
      const res = await fetch(`${API}/witness/${token}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFatal(
          (Array.isArray(data?.message) ? data.message.join(' ') : data?.message) ??
            'This link is not valid.',
        );
        return;
      }
      setState(data);
      if (data.status === 'COMPLETED') setDone(true);
      else if (data.status === 'VERIFIED') setStep(1);
    })().catch(() => setFatal('We could not open this link.'));
  }, [token]);

  const set = (k: string, v: string) => {
    setAnswers((a) => ({ ...a, [k]: v }));
    setProblems((p) => {
      if (!p[k]) return p;
      const next = { ...p };
      delete next[k];
      return next;
    });
  };

  // ── Location, for "Signed at" ─────────────────────────────────────
  //
  // ⚠️ THE TOWN, NOT THE COORDINATES. A statement needs a place of signature;
  // it does not need a stranger's position, and we neither send nor store one.
  // The lookup runs in the browser and only its answer travels.
  const useMyLocation = async () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Location is not available on this device — please type it in.');
      return;
    }
    setLocating(true);
    setError(null);
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, {
          enableHighAccuracy: false,
          timeout: 10_000,
          maximumAge: 60_000,
        }),
      );
      const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
      if (!key) {
        setError('Please type where you are signing.');
        return;
      }
      const r = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${pos.coords.latitude},${pos.coords.longitude}&result_type=locality|administrative_area_level_1&key=${key}`,
      );
      const j = await r.json();
      const best = j?.results?.[0]?.formatted_address as string | undefined;
      if (best) setPlace(best.replace(/, South Africa$/, ''));
      else setError('We could not name that place — please type it in.');
    } catch {
      setError('We could not read your location — please type it in.');
    } finally {
      setLocating(false);
    }
  };

  if (fatal) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">This link cannot be opened</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{fatal}</p>
        <p className="mt-4 text-sm text-[var(--text-secondary)]">
          Links last one hour. Ask the person who sent it to send a new one.
        </p>
      </Shell>
    );
  }

  if (!state) {
    return (
      <Shell>
        <p className="text-sm text-[var(--text-secondary)]">Opening…</p>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <div className="py-6 text-center">
          <h1 className="text-lg font-semibold">Thank you</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--text-secondary)]">
            Your statement has been signed and sent to {state.applicantName}.
            There is nothing further for you to do, and this link is now closed.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <WitnessStepper steps={STEPS} current={step} />

      <div className="rounded border border-[var(--border)] bg-[var(--bg-card)] p-4 sm:p-6">
        {error && (
          <p
            role="alert"
            className="mb-3 rounded border border-[var(--danger,#b3261e)] px-3 py-2 text-sm text-[var(--danger,#b3261e)]"
          >
            {error}
          </p>
        )}

        {/* ── 1 · Verify the number ──────────────────────────────── */}
        {step === 0 && (
          <section>
            <h1 className="text-lg font-semibold">Verify your number</h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              {state.applicantName} has asked you to give a character statement
              for a firearm licence application. Before you start, we send a
              code to {state.phoneHint} to check we have the right person.
            </p>
            {!codeSent ? (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await post('/code');
                    setCodeSent(true);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
                className="mt-4 rounded bg-[var(--brand,#1b3a2f)] px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {busy ? 'Sending…' : 'Send me the code'}
              </button>
            ) : (
              <div className="mt-4">
                <label className="block text-sm font-medium" htmlFor="otp">
                  Enter the code
                </label>
                <input
                  id="otp"
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, '').slice(0, 4))
                  }
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="4 digits"
                  className="mt-1 w-40 rounded border border-[var(--border)] px-3 py-2 text-lg tracking-widest"
                />
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={busy || code.length < 4}
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        await post('/verify', { code });
                        setStep(1);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="rounded bg-[var(--brand,#1b3a2f)] px-4 py-2 text-sm text-white disabled:opacity-50"
                  >
                    Continue
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        await post('/code');
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="rounded border border-[var(--border)] px-4 py-2 text-sm disabled:opacity-50"
                  >
                    Send it again
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── 2 · What this is ───────────────────────────────────── */}
        {step === 1 && (
          <section>
            <h1 className="text-lg font-semibold">
              A character statement for {state.applicantName}
            </h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {state.licenceTypeLabel}
            </p>
            <div className="mt-4 space-y-3">
              {state.notices.map((n, i) => (
                <p
                  key={i}
                  className="border-l-2 border-[var(--border)] pl-3 text-sm text-[var(--text-secondary)]"
                >
                  {n}
                </p>
              ))}
            </div>
            <Nav onNext={() => setStep(2)} nextLabel="I understand — continue" />
          </section>
        )}

        {/* ── 3 · About you ──────────────────────────────────────── */}
        {step === 2 && (
          <section>
            <h1 className="text-lg font-semibold">About you</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              The officer needs to know who gave this statement.
            </p>
            <div className="mt-4 space-y-4">
              {state.fields.map((f) => (
                <FieldRow
                  key={f.key}
                  field={f}
                  value={answers[f.key] ?? ''}
                  problem={problems[f.key]}
                  onChange={(v) => set(f.key, v)}
                  hidden={
                    f.key === 'relationship_other' &&
                    answers.relationship !== 'Other'
                  }
                />
              ))}
            </div>
            <Nav onBack={() => setStep(1)} onNext={() => setStep(3)} />
          </section>
        )}

        {/* ── 4 · The three questions ────────────────────────────── */}
        {step === 3 && (
          <section>
            <h1 className="text-lg font-semibold">Three questions</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Answer each from your own knowledge of {state.applicantName}.
              “No” and “I am not able to say” are proper answers.
            </p>
            <div className="mt-4 space-y-5">
              {state.declarations.map((d) => (
                <fieldset key={d.key}>
                  <legend className="text-sm">
                    <span className="font-medium">{d.number}. </span>
                    {d.text}{' '}
                    <span className="text-xs text-[var(--text-secondary)]">
                      · {d.cite}
                    </span>
                  </legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {state.answerOptions.map((o) => (
                      <button
                        key={o}
                        type="button"
                        onClick={() => set(d.key, o)}
                        aria-pressed={answers[d.key] === o}
                        className={[
                          'rounded border px-3 py-1.5 text-sm',
                          answers[d.key] === o
                            ? 'border-[var(--brand,#1b3a2f)] bg-[var(--brand,#1b3a2f)] text-white'
                            : 'border-[var(--border)]',
                        ].join(' ')}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                  {problems[d.key] && (
                    <p className="mt-1 text-xs text-[var(--danger,#b3261e)]">
                      {problems[d.key]}
                    </p>
                  )}
                </fieldset>
              ))}

              {state.declarations.some((d) =>
                ['No', 'I am not able to say'].includes(answers[d.key] ?? ''),
              ) && (
                <div>
                  <label className="block text-sm font-medium" htmlFor="explain">
                    Please explain your answer
                  </label>
                  <p className="text-xs text-[var(--text-secondary)]">
                    A “No” on its own tells the officer something is wrong and
                    nothing about what, which is unfair to everybody.
                  </p>
                  <textarea
                    id="explain"
                    rows={4}
                    value={answers.explain ?? ''}
                    onChange={(e) => set('explain', e.target.value)}
                    className="mt-1 w-full rounded border border-[var(--border)] px-3 py-2 text-sm"
                  />
                  {problems.explain && (
                    <p className="mt-1 text-xs text-[var(--danger,#b3261e)]">
                      {problems.explain}
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium" htmlFor="comment">
                  Anything else you would like to add
                </label>
                <p className="text-xs text-[var(--text-secondary)]">
                  Optional, and in your own words. There is no right answer.
                </p>
                <textarea
                  id="comment"
                  rows={5}
                  value={answers.comment ?? ''}
                  onChange={(e) => set('comment', e.target.value)}
                  className="mt-1 w-full rounded border border-[var(--border)] px-3 py-2 text-sm"
                />
              </div>
            </div>
            <Nav onBack={() => setStep(2)} onNext={() => setStep(4)} />
          </section>
        )}

        {/* ── 5 · Sign ───────────────────────────────────────────── */}
        {step === 4 && (
          <section>
            <h1 className="text-lg font-semibold">Sign your statement</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              I confirm that the answers I have given are my own and are true to
              the best of my knowledge and belief.
            </p>

            <div className="mt-4">
              <label className="block text-sm font-medium" htmlFor="place">
                Signed at
              </label>
              <div className="mt-1 flex flex-wrap gap-2">
                <input
                  id="place"
                  value={place}
                  onChange={(e) => setPlace(e.target.value)}
                  placeholder="Town or city"
                  className="min-w-0 flex-1 rounded border border-[var(--border)] px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={locating}
                  onClick={useMyLocation}
                  className="rounded border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50"
                >
                  {locating ? 'Finding…' : 'Use my location'}
                </button>
              </div>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                We record the town only — never your exact position.
              </p>
            </div>

            <div className="mt-4">
              <p className="text-sm font-medium">Your signature</p>
              <div className="mt-1">
                <WitnessSignaturePad onChange={setSignature} />
              </div>
            </div>

            <p className="mt-4 text-xs text-[var(--text-secondary)]">
              Dated automatically when you submit.
            </p>

            <Nav
              onBack={() => setStep(3)}
              nextLabel={busy ? 'Submitting…' : 'Sign and submit'}
              nextDisabled={busy || !signature}
              onNext={async () => {
                setBusy(true);
                setError(null);
                setProblems({});
                try {
                  await post('/submit', { answers, signature, place });
                  setDone(true);
                } catch (e) {
                  const err = e as Error & {
                    problems?: Record<string, string>;
                  };
                  setError(err.message);
                  if (err.problems) {
                    setProblems(err.problems);
                    // ⚠️ SEND THEM TO THE STEP THAT HAS THE PROBLEM. A
                    // validation error reported on the signature screen, about
                    // a field two screens back, is an error nobody can act on.
                    const aboutKeys = new Set(state.fields.map((f) => f.key));
                    const first = Object.keys(err.problems)[0];
                    if (aboutKeys.has(first)) setStep(2);
                    else setStep(3);
                  }
                } finally {
                  setBusy(false);
                }
              }}
            />
          </section>
        )}
      </div>

      <p className="mt-4 text-center text-xs text-[var(--text-secondary)]">
        All Outdoor · {state.version}
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
      {children}
    </main>
  );
}

function Nav({
  onBack,
  onNext,
  nextLabel = 'Continue',
  nextDisabled,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
}) {
  return (
    <div className="mt-6 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        className="rounded bg-[var(--brand,#1b3a2f)] px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {nextLabel}
      </button>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="rounded border border-[var(--border)] px-4 py-2 text-sm"
        >
          Back
        </button>
      )}
    </div>
  );
}

function FieldRow({
  field,
  value,
  problem,
  onChange,
  hidden,
}: {
  field: Field;
  value: string;
  problem?: string;
  onChange: (v: string) => void;
  hidden?: boolean;
}) {
  if (hidden) return null;
  const id = `f-${field.key}`;
  return (
    <div>
      <label className="block text-sm font-medium" htmlFor={id}>
        {field.label}
        {!field.required && (
          <span className="ml-1 text-xs font-normal text-[var(--text-secondary)]">
            optional
          </span>
        )}
      </label>
      {field.hint && (
        <p className="text-xs text-[var(--text-secondary)]">{field.hint}</p>
      )}
      {field.kind === 'select' ? (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded border border-[var(--border)] px-3 py-2 text-sm"
        >
          <option value="">Choose…</option>
          {(field.choices ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          value={value}
          maxLength={field.maxLength}
          inputMode={
            field.kind === 'tel' || field.kind === 'id' ? 'numeric' : undefined
          }
          autoComplete={
            field.kind === 'tel'
              ? 'tel'
              : field.key === 'surname'
                ? 'family-name'
                : field.key === 'first_names'
                  ? 'given-name'
                  : 'off'
          }
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded border border-[var(--border)] px-3 py-2 text-sm"
        />
      )}
      {problem && (
        <p className="mt-1 text-xs text-[var(--danger,#b3261e)]">{problem}</p>
      )}
    </div>
  );
}
