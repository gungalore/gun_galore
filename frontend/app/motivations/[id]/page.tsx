'use client';

import { useAuth } from '@clerk/nextjs';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StepAccordion, StepStatus } from '@/components/step-accordion';
import {
  FollowUp,
  MotivationApiError,
  MotivationDetail,
  MotivationField,
  ProfileOffer,
  UploadRow,
  groupBySection,
  motivationsApi,
  visibleFields,
} from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// The motivation wizard.
//
// One long sitting — fifteen minutes of someone's circumstances, their safe,
// their history — so the two things that matter most are that NOTHING IS EVER
// LOST and that they always know what is still outstanding.
//
// AUTOSAVE, DEBOUNCED, PLUS A LOCAL DRAFT. The server is the record, but a
// dropped connection halfway through a paragraph about a robbery must not cost
// someone that paragraph. localStorage holds what has been typed since the last
// successful save, and is cleared only once the server confirms.
//
// THE QUESTIONS COME FROM THE SERVER. The field registry is 170 definitions
// with conditional visibility and per-field caps; a second copy here would
// drift on the first change, and the two halves disagreeing about what is
// required is a bug nobody sees until an application will not generate.
//
// ⚠️ NO OUTCOME LANGUAGE. Not "improves your chances", not "approval likely",
// no success rates — not here, not in the document, not in an email. We sell
// structure and completeness, never odds.
// ────────────────────────────────────────────────────────────────────

const AUTOSAVE_MS = 1200;
const DRAFT_KEY = (id: string) => `motivation-draft:${id}`;

const UPLOAD_KINDS = [
  { value: 'IDENTITY_DOCUMENT', label: 'Copy of your ID' },
  { value: 'COMPETENCY_CERTIFICATE', label: 'Competency certificate' },
  { value: 'PROFICIENCY_CERTIFICATE', label: 'Proficiency / training certificate' },
  { value: 'CURRENT_LICENCE', label: 'Existing firearm licence' },
  { value: 'ASSOCIATION_CARD', label: 'Association membership proof' },
  { value: 'ADDRESS_CONFIRMATION', label: 'Proof of address' },
  { value: 'SAFE_PHOTO', label: 'Photograph of your safe' },
  { value: 'SAFE_INSTALLATION', label: 'Safe bolted to the wall' },
  { value: 'INCIDENT_REPORT', label: 'Incident report / SAPS case number' },
  { value: 'CHARACTER_REFERENCE', label: 'Character reference' },
  { value: 'OTHER', label: 'Something else' },
];

export default function MotivationWizardPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [detail, setDetail] = useState<MotivationDetail | null>(null);
  const [fields, setFields] = useState<MotivationField[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [offer, setOffer] = useState<ProfileOffer | null>(null);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [messages, setMessages] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  const [expanded, setExpanded] = useState(1);
  const [furthest, setFurthest] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [testimonialConsent, setTestimonialConsent] = useState(false);

  // A stable getter, so the effects below do not re-run every render just
  // because Clerk handed back a new function identity.
  const token = useCallback(() => getToken(), [getToken]);

  // One-shot restore. Without the ref this re-runs on every answers change and
  // fights the user's typing.
  const restored = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await motivationsApi.get(token, id);
        if (!alive) return;
        const fs = await motivationsApi.fields(token, d.licenceType);
        if (!alive) return;

        // A local draft newer than the server's copy wins — it exists only
        // because a save did not complete.
        let merged = d.answers ?? {};
        if (!restored.current) {
          restored.current = true;
          try {
            const raw = localStorage.getItem(DRAFT_KEY(id));
            if (raw) merged = { ...merged, ...(JSON.parse(raw) as object) };
          } catch {
            /* a corrupt draft is not worth failing the page over */
          }
        }

        setDetail(d);
        setFields(fs.fields);
        setAnswers(merged);
        setUploads(await motivationsApi.uploads(token, id));
        setMessages(await motivationsApi.messages(token, id));
        try {
          setOffer(await motivationsApi.profileOffer(token, id));
        } catch {
          /* prefill is a courtesy; never block the wizard on it */
        }
      } catch (e) {
        if (alive) {
          setError(
            e instanceof MotivationApiError
              ? e.message
              : 'We could not open this application.',
          );
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, token]);

  // Debounced autosave. The timer is keyed on the answers object, so a burst of
  // typing collapses into one request once they pause.
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current || !detail) return;
    localStorage.setItem(DRAFT_KEY(id), JSON.stringify(answers));
    setSaving('saving');
    const t = setTimeout(async () => {
      try {
        const res = await motivationsApi.saveAnswers(token, id, answers);
        setDetail((d) => (d ? { ...d, missingRequired: res.missingRequired } : d));
        // Cleared only once the server has it. Clearing on send would lose the
        // draft precisely when the request failed.
        localStorage.removeItem(DRAFT_KEY(id));
        dirty.current = false;
        setSaving('saved');
      } catch {
        setSaving('error');
      }
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [answers, detail, id, token]);

  const setAnswer = (key: string, value: string) => {
    dirty.current = true;
    setAnswers((a) => ({ ...a, [key]: value }));
  };

  const shown = useMemo(() => visibleFields(fields, answers), [fields, answers]);
  const sections = useMemo(() => groupBySection(shown), [shown]);
  const outstanding = detail?.missingRequired ?? [];
  const openQuestions = messages.filter(
    (m) => m.role === 'assistant' && !(answers[m.fieldKey ?? ''] ?? '').trim(),
  );

  const stepStatus = (n: number, complete: boolean): StepStatus => {
    if (complete) return 'complete';
    if (n === expanded) return 'active';
    return n <= furthest ? 'idle' : 'locked';
  };

  const go = (n: number) => {
    setExpanded(n);
    setFurthest((f) => Math.max(f, n));
  };

  if (loading) {
    return <main className="mx-auto max-w-3xl p-6">Loading your application…</main>;
  }
  if (error || !detail) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="text-red-700">{error}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Your firearm licence motivation</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Reference {detail.referenceNumber}. Everything stays here until you
          print it — nothing is sent to SAPS by us.
        </p>
        <p className="mt-2 text-xs text-neutral-500" aria-live="polite">
          {saving === 'saving' && 'Saving…'}
          {saving === 'saved' && 'Saved'}
          {saving === 'error' &&
            'We could not save just now — your answers are kept on this device and will save again shortly.'}
        </p>
      </header>

      {/* 1 — the profile offer */}
      {offer && offer.fields.length > 0 && !offer.alreadyConsented && (
        <StepAccordion
          number={1}
          title="Use what we already have?"
          description={offer.note}
          status={stepStatus(1, offer.alreadyConsented)}
          expanded={expanded === 1}
          onToggle={() => go(1)}
          hideContinue
        >
          <div className="space-y-3">
            <p className="text-sm text-neutral-700">
              We can fill these in from your All Outdoor profile. Nothing is
              copied until you say so, and anything you have already typed is
              left alone.
            </p>
            <ul className="divide-y rounded border">
              {offer.fields.map((f) => (
                <li key={f.key} className="flex justify-between gap-4 p-3 text-sm">
                  <span className="text-neutral-600">{f.label}</span>
                  <span className="text-right">
                    <span className="font-medium">{f.value}</span>
                    <span className="block text-xs text-neutral-500">
                      from {f.from}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded bg-neutral-900 px-4 py-2 text-sm text-white"
                onClick={async () => {
                  const res = await motivationsApi.useProfile(token, id);
                  const d = await motivationsApi.get(token, id);
                  setAnswers((a) => ({ ...d.answers, ...a }));
                  setDetail(d);
                  setOffer((o) =>
                    o ? { ...o, alreadyConsented: true } : o,
                  );
                  if (res.filled >= 0) go(2);
                }}
              >
                Yes, use these
              </button>
              <button
                type="button"
                className="rounded border px-4 py-2 text-sm"
                onClick={() => go(2)}
              >
                No, I will type them
              </button>
            </div>
          </div>
        </StepAccordion>
      )}

      {/* 2 — the questions, straight from the registry */}
      {sections.map((sec, i) => {
        const n = i + 2;
        const missingHere = sec.fields.filter((f) =>
          outstanding.includes(f.key),
        ).length;
        return (
          <StepAccordion
            key={sec.section}
            number={n}
            title={sec.section}
            status={stepStatus(n, missingHere === 0)}
            expanded={expanded === n}
            onToggle={() => go(n)}
            summary={
              missingHere > 0 ? `${missingHere} still to answer` : 'Done'
            }
            onContinue={() => go(n + 1)}
          >
            <div className="space-y-4">
              {sec.fields.map((f) => (
                <FieldInput
                  key={f.key}
                  field={f}
                  value={answers[f.key] ?? ''}
                  missing={outstanding.includes(f.key)}
                  onChange={(v) => setAnswer(f.key, v)}
                />
              ))}
            </div>
          </StepAccordion>
        );
      })}

      {/* 3 — Boet's follow-ups */}
      {openQuestions.length > 0 && (
        <section className="mt-6 rounded border border-amber-300 bg-amber-50 p-4">
          <h2 className="font-medium">A few things Boet wants to ask</h2>
          <p className="mt-1 text-sm text-neutral-700">
            These are the answers that were too thin to build a strong document
            from.
          </p>
          <ul className="mt-3 space-y-4">
            {openQuestions.map((q) => (
              <li key={q.id}>
                <p className="text-sm font-medium">{q.content}</p>
                <FollowUpAnswer
                  onSubmit={async (text) => {
                    await motivationsApi.answerFollowUp(token, id, q.id, text);
                    setMessages(await motivationsApi.messages(token, id));
                    setDetail(await motivationsApi.get(token, id));
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 4 — documents */}
      <section className="mt-6 rounded border p-4">
        <h2 className="font-medium">Supporting documents</h2>
        <p className="mt-1 text-sm text-neutral-600">
          These are stored encrypted on our own server and are never public.
          Each one becomes a lettered annexure.
        </p>
        <UploadPanel
          uploads={uploads}
          onAdd={async (kind, file) => {
            const row = await motivationsApi.addUpload(token, id, kind, file);
            setUploads((u) => [...u, row]);
          }}
          onRemove={async (uploadId) => {
            await motivationsApi.removeUpload(token, id, uploadId);
            setUploads((u) => u.filter((x) => x.id !== uploadId));
          }}
        />
      </section>

      {/* 5 — declaration and generate */}
      <section className="mt-6 rounded border p-4">
        <h2 className="font-medium">Before we prepare it</h2>
        {outstanding.length > 0 ? (
          <p className="mt-2 text-sm text-neutral-700">
            {outstanding.length} answer{outstanding.length === 1 ? '' : 's'}{' '}
            still to give. The sections above show which.
          </p>
        ) : (
          <>
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={testimonialConsent}
                onChange={(e) => setTestimonialConsent(e.target.checked)}
              />
              <span>
                You may ask me later how my application went. (Optional.)
              </span>
            </label>
            <p className="mt-3 text-sm text-neutral-700">
              By continuing you confirm that everything you have told us is
              true, and that you submit the motivation as your own. It is not
              legal advice.
            </p>
            <button
              type="button"
              disabled={generating}
              className="mt-3 rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
              onClick={async () => {
                setGenerating(true);
                setError(null);
                try {
                  await motivationsApi.acceptDeclaration(
                    token,
                    id,
                    testimonialConsent,
                  );
                  await motivationsApi.generate(token, id);
                  const d = await motivationsApi.get(token, id);
                  setDetail(d);
                  setMessages(await motivationsApi.messages(token, id));
                  if (d.status === 'COMPLETED') router.refresh();
                } catch (e) {
                  setError(
                    e instanceof MotivationApiError
                      ? e.message
                      : 'We could not prepare the document just now.',
                  );
                } finally {
                  setGenerating(false);
                }
              }}
            >
              {generating ? 'Preparing…' : 'Prepare my motivation'}
            </button>
          </>
        )}

        {detail.status === 'COMPLETED' && (
          <p className="mt-4">
            <a
              className="rounded border px-4 py-2 text-sm"
              href={motivationsApi.pdfUrl(id)}
              target="_blank"
              rel="noreferrer"
            >
              Open your motivation
            </a>
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      </section>
    </main>
  );
}

/** One question, rendered from its registry definition. */
function FieldInput({
  field,
  value,
  missing,
  onChange,
}: {
  field: MotivationField;
  value: string;
  missing: boolean;
  onChange: (v: string) => void;
}) {
  const base =
    'mt-1 w-full rounded border px-3 py-2 text-sm ' +
    (missing ? 'border-amber-400' : 'border-neutral-300');

  return (
    <div>
      <label className="block text-sm font-medium" htmlFor={field.key}>
        {field.label}
        {field.required && <span aria-hidden> *</span>}
      </label>
      {field.help && (
        <p className="mt-0.5 text-xs text-neutral-500">{field.help}</p>
      )}

      {field.kind === 'long' && (
        <textarea
          id={field.key}
          className={base}
          rows={5}
          maxLength={field.maxLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {(field.kind === 'short' || field.kind === 'date') && (
        <input
          id={field.key}
          type={field.kind === 'date' ? 'date' : 'text'}
          className={base}
          maxLength={field.maxLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {(field.kind === 'choice' || field.kind === 'yesno') && (
        <select
          id={field.key}
          className={base}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Choose…</option>
          {(field.choices ?? ['No', 'Yes']).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      )}

      {field.kind === 'multi' && (
        <div className="mt-1 flex flex-wrap gap-3">
          {(field.choices ?? []).map((c) => {
            const picked = value
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean);
            return (
              <label key={c} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={picked.includes(c)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...picked, c]
                      : picked.filter((x) => x !== c);
                    // Normalised to the offered order so the server's own
                    // ordering and ours agree.
                    onChange(
                      (field.choices ?? [])
                        .filter((x) => next.includes(x))
                        .join(', '),
                    );
                  }}
                />
                {c}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FollowUpAnswer({ onSubmit }: { onSubmit: (t: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-2">
      <textarea
        className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        type="button"
        disabled={busy || !text.trim()}
        className="mt-1 rounded border px-3 py-1.5 text-sm disabled:opacity-50"
        onClick={async () => {
          setBusy(true);
          try {
            await onSubmit(text.trim());
            setText('');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Saving…' : 'Answer'}
      </button>
    </div>
  );
}

function UploadPanel({
  uploads,
  onAdd,
  onRemove,
}: {
  uploads: UploadRow[];
  onAdd: (kind: string, file: File) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [kind, setKind] = useState(UPLOAD_KINDS[0].value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded border border-neutral-300 px-3 py-2 text-sm"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          aria-label="Document type"
        >
          {UPLOAD_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        <input
          type="file"
          className="text-sm"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setErr(null);
            try {
              await onAdd(kind, file);
            } catch (ex) {
              setErr(
                ex instanceof MotivationApiError
                  ? ex.message
                  : 'That upload did not work.',
              );
            } finally {
              setBusy(false);
              e.target.value = '';
            }
          }}
        />
      </div>
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}

      <ul className="mt-3 divide-y rounded border">
        {uploads.length === 0 && (
          <li className="p-3 text-sm text-neutral-500">Nothing added yet.</li>
        )}
        {uploads.map((u) => (
          <li key={u.id} className="flex items-center justify-between gap-3 p-3 text-sm">
            <span>
              {u.annexure && (
                <span className="mr-2 rounded bg-neutral-100 px-1.5 py-0.5 text-xs">
                  Annexure {u.annexure}
                </span>
              )}
              {u.label}
              {!u.available && (
                <span className="ml-2 text-xs text-neutral-500">
                  (deleted under our retention policy)
                </span>
              )}
            </span>
            <button
              type="button"
              className="text-xs underline"
              onClick={() => onRemove(u.id)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
