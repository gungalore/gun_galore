'use client';

import { useState, FormEvent, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { PhotoDropzone } from '@/components/photo-dropzone';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: '6px',
  padding: '8px 12px',
  fontSize: '14px',
  outline: 'none',
};

function Field({ label, children, hint }: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label
        className="block text-sm mb-1.5"
        style={{ color: 'var(--text-secondary)' }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function formatRand(cents: number) {
  return `R${(cents / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getAdminToken(): string {
  if (typeof document === 'undefined') return '';
  return (
    document.cookie
      .split('; ')
      .find((c) => c.startsWith('admin_token='))
      ?.split('=')[1] ?? ''
  );
}

export default function CreateCompetitionPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);

  const [form, setForm] = useState({
    title: '',
    description: '',
    itemPrice: '',      // R, selling price
    itemCost: '',       // R, what we paid
    ticketPrice: '',    // R, per ticket
    question: '',
    optionA: '',
    optionB: '',
    optionC: '',        // ALWAYS correct (backend hardcodes)
    optionD: '',
    startTime: new Date().toISOString().slice(0, 16),
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Live derived target ticket count: ceil(itemPrice / ticketPrice).
  // Operator no longer types this — they see it computed as they fill
  // in price + ticket price.
  const calc = useMemo(() => {
    const priceCents = Math.round(parseFloat(form.itemPrice || '0') * 100);
    const costCents = Math.round(parseFloat(form.itemCost || '0') * 100);
    const ticketCents = Math.round(parseFloat(form.ticketPrice || '0') * 100);
    const target =
      priceCents > 0 && ticketCents > 0
        ? Math.ceil(priceCents / ticketCents)
        : 0;
    const projectedRevenue = ticketCents * target;
    const profit = projectedRevenue - costCents;
    return {
      priceCents,
      costCents,
      ticketCents,
      target,
      projectedRevenue,
      profit,
    };
  }, [form]);

  const questionReady =
    form.question.trim().length >= 5 &&
    form.optionA.trim() &&
    form.optionB.trim() &&
    form.optionC.trim() &&
    form.optionD.trim();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (photos.length === 0) {
        throw new Error('Add at least one photo of the prize.');
      }
      if (!questionReady) {
        throw new Error('Question and all four options are required.');
      }
      if (calc.ticketCents > calc.priceCents) {
        throw new Error('Ticket price cannot be higher than the item price.');
      }

      const body = {
        title: form.title.trim(),
        description: form.description.trim(),
        itemValueCents: calc.priceCents,
        itemCostCents: calc.costCents,
        ticketPriceCents: calc.ticketCents,
        question: form.question.trim(),
        optionA: form.optionA.trim(),
        optionB: form.optionB.trim(),
        optionC: form.optionC.trim(),
        optionD: form.optionD.trim(),
        startTime: new Date(form.startTime).toISOString(),
      };

      const adminToken = getAdminToken();
      const res = await fetch(`${API_URL}/admin/raffles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          Array.isArray(err.message)
            ? err.message.join(', ')
            : (err.message ?? `Error ${res.status}`),
        );
      }
      const created = await res.json();
      const raffleId = created.raffle?.id ?? created.id;

      let uploaded = 0;
      for (const file of photos) {
        const fd = new FormData();
        fd.append('image', file);
        const up = await fetch(
          `${API_URL}/admin/raffles/${raffleId}/images`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${adminToken}` },
            body: fd,
          },
        );
        if (!up.ok) {
          const errBody = await up.json().catch(() => ({}));
          const detail =
            (errBody as { message?: string })?.message ?? `${up.status}`;
          throw new Error(
            `Photo ${uploaded + 1} of ${photos.length} (${file.name}) ` +
              `failed to upload — ${detail}.`,
          );
        }
        uploaded += 1;
      }

      router.push('/admin/competitions');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-[1000px]">
      <h1
        className="text-xl mb-6"
        style={{ color: 'var(--text-primary)', fontWeight: 500 }}
      >
        Create competition
      </h1>

      {error && (
        <div
          className="mb-4 px-4 py-3 rounded-[6px] text-sm"
          style={{
            background: 'rgba(200,16,46,0.08)',
            border: '0.5px solid var(--red)',
            color: 'var(--red)',
          }}
        >
          {error}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6"
      >
        <div className="space-y-4">
          <Field label="Prize title">
            <input
              type="text"
              required
              minLength={5}
              maxLength={200}
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              style={inputStyle}
              placeholder="e.g. Vortex Diamondback Tactical 4-16x44"
            />
          </Field>

          <Field label="Description">
            <textarea
              required
              minLength={20}
              maxLength={5000}
              rows={5}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              style={{ ...inputStyle, resize: 'vertical' }}
              placeholder="What is the prize? Include condition, accessories, etc."
            />
          </Field>

          <Field
            label="Photos"
            hint="Drag to reorder. First photo is the cover. Up to 10 images."
          >
            <PhotoDropzone
              files={photos}
              onChange={setPhotos}
              minFiles={1}
              maxFiles={10}
            />
          </Field>

          {/* Three pricing inputs — that's the entire pricing UI. The
              number of tickets is derived (ceil itemPrice / ticketPrice)
              and shown live in the side panel. */}
          <div className="grid grid-cols-3 gap-4">
            <Field label="Item price (R)" hint="What it sells for">
              <input
                type="number"
                required
                step="0.01"
                min="10"
                value={form.itemPrice}
                onChange={(e) => set('itemPrice', e.target.value)}
                style={inputStyle}
                placeholder="0.00"
              />
            </Field>
            <Field label="Item cost (R)" hint="What we paid">
              <input
                type="number"
                required
                step="0.01"
                min="0"
                value={form.itemCost}
                onChange={(e) => set('itemCost', e.target.value)}
                style={inputStyle}
                placeholder="0.00"
              />
            </Field>
            <Field label="Ticket price (R)" hint="Per ticket">
              <input
                type="number"
                required
                step="0.01"
                min="1"
                value={form.ticketPrice}
                onChange={(e) => set('ticketPrice', e.target.value)}
                style={inputStyle}
                placeholder="0.00"
              />
            </Field>
          </div>

          {/* Multiple-choice question — C is always correct. */}
          <div
            className="rounded-[6px] p-4"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
            }}
          >
            <div className="flex items-baseline justify-between mb-3">
              <h3
                className="text-sm"
                style={{ color: 'var(--text-primary)', fontWeight: 500 }}
              >
                Multiple choice question
              </h3>
              <span
                className="text-xs px-2 py-0.5 rounded-[4px]"
                style={{
                  background: 'rgba(34,197,94,0.12)',
                  color: '#22c55e',
                }}
              >
                Option C is the correct answer
              </span>
            </div>

            <Field label="Question">
              <textarea
                required
                minLength={5}
                maxLength={500}
                rows={2}
                value={form.question}
                onChange={(e) => set('question', e.target.value)}
                style={{ ...inputStyle, resize: 'vertical' }}
                placeholder="e.g. What does FFP stand for in rifle-scope terminology?"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3 mt-3">
              <OptionField
                letter="A"
                value={form.optionA}
                onChange={(v) => set('optionA', v)}
              />
              <OptionField
                letter="B"
                value={form.optionB}
                onChange={(v) => set('optionB', v)}
              />
              <OptionField
                letter="C"
                value={form.optionC}
                onChange={(v) => set('optionC', v)}
                correct
              />
              <OptionField
                letter="D"
                value={form.optionD}
                onChange={(v) => set('optionD', v)}
              />
            </div>
          </div>

          <Field label="Start time">
            <input
              type="datetime-local"
              required
              value={form.startTime}
              onChange={(e) => set('startTime', e.target.value)}
              style={inputStyle}
            />
          </Field>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-[6px] text-sm font-medium"
            style={{
              background: submitting ? 'var(--bg-inset)' : 'var(--red)',
              color: submitting ? 'var(--text-tertiary)' : '#fff',
              border: 'none',
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Creating…' : 'Create competition'}
          </button>
        </div>

        {/* Side panel — shows derived target ticket count so the
            operator can see the math as they fill in the form. */}
        <aside>
          <div
            className="rounded-[6px] p-4 sticky top-4"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
            }}
          >
            <p
              className="text-xs uppercase mb-3"
              style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}
            >
              Operator summary
            </p>
            <Row label="Item price" value={formatRand(calc.priceCents)} />
            <Row label="Item cost" value={formatRand(calc.costCents)} />
            <Row label="Ticket price" value={formatRand(calc.ticketCents)} />
            <hr style={{ border: 'none', borderTop: '0.5px solid var(--border)', margin: '8px 0' }} />
            <Row
              label="Tickets to sell"
              value={calc.target > 0 ? String(calc.target) : '—'}
              strong
            />
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              ceil(item price ÷ ticket price)
            </p>
            <hr style={{ border: 'none', borderTop: '0.5px solid var(--border)', margin: '8px 0' }} />
            <Row
              label="Revenue at sell-out"
              value={formatRand(calc.projectedRevenue)}
            />
            <Row
              label="Profit"
              value={formatRand(calc.profit)}
              color={calc.profit >= 0 ? '#22c55e' : 'var(--red)'}
            />
          </div>
        </aside>
      </form>
    </div>
  );
}

function OptionField({
  letter,
  value,
  onChange,
  correct,
}: {
  letter: 'A' | 'B' | 'C' | 'D';
  value: string;
  onChange: (v: string) => void;
  correct?: boolean;
}) {
  return (
    <div>
      <label
        className="flex items-center gap-2 text-sm mb-1.5"
        style={{ color: 'var(--text-secondary)' }}
      >
        <span
          className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs"
          style={{
            background: correct ? 'rgba(34,197,94,0.18)' : 'var(--bg-inset)',
            color: correct ? '#22c55e' : 'var(--text-secondary)',
            fontWeight: 500,
            border: correct ? '0.5px solid #22c55e' : '0.5px solid var(--border)',
          }}
        >
          {letter}
        </span>
        Option {letter}
        {correct && (
          <span className="text-xs" style={{ color: '#22c55e' }}>
            (correct)
          </span>
        )}
      </label>
      <input
        type="text"
        required
        maxLength={200}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
        placeholder={correct ? 'The correct answer goes here' : `Distractor ${letter}`}
      />
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  color,
}: {
  label: string;
  value: string;
  strong?: boolean;
  color?: string;
}) {
  return (
    <div className="flex justify-between text-xs py-1">
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span
        style={{
          color: color ?? 'var(--text-primary)',
          fontWeight: strong ? 500 : 400,
          fontSize: strong ? '14px' : '12px',
        }}
      >
        {value}
      </span>
    </div>
  );
}
