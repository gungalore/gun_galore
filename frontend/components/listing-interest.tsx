'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/lib/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// ────────────────────────────────────────────────────────────────────
// The seller's "interest" panel.
//
// Deliberate click, never hover: this is a seller-facing read of how their own
// listing is performing, and the operator's requirement was that it must not
// sit open on the page. So the card carries a small ⓘ/Interest button and
// NOTHING numeric — the numbers only exist after a tap.
//
// ⚠️ THE PANEL IS PORTALLED AND FIXED, NOT AN ABSOLUTE POPOVER INSIDE THE
// CARD. A card in a two-column grid can sit anywhere, and an absolutely
// positioned panel is clipped by any ancestor that clips (and is trapped in
// the card's stacking context). Fixed + body portal keeps it above the shell
// and lets both form factors place it deliberately.
//
// Two forms, one component:
//   • ≥ 640px — a popover anchored under the button, nudged back inside the
//     viewport the same way HelpTip does it.
//   • < 640px — a bottom sheet with a scrim, because a card can be near the
//     bottom edge and a popover would open into nothing.
//
// ⚠️ "Views" IS AN EVENT COUNT, NOT A HEADCOUNT. One buyer refreshing is two
// views and a crawler is one too. Every other row (saved/offers/questions/
// watching) is one row per member, so those really are distinct people. The
// copy must not call views "people", and the backend docs say the same.
// ────────────────────────────────────────────────────────────────────

interface Counter {
  total: number;
  last7d: number;
}

interface InterestData {
  listingId: string;
  listingType: string;
  status: string;
  liveSinceDays: number;
  views: Counter;
  saves: Counter;
  offers: Counter & { open: number };
  bids: Counter;
  watchers: Counter;
  questions: Counter;
}

const Z_POPOVER = 60;
const Z_SCRIM = 120;
const Z_SHEET = 121;

const PANEL_WIDTH = 316;

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString('en-ZA') : '—';
}

export function ListingInterest({
  listingId,
  className,
}: {
  listingId: string;
  className?: string;
}) {
  const { getToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<InterestData | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [phone, setPhone] = useState(false);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    above: boolean;
    width: number;
  } | null>(null);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Guards against an in-flight fetch landing after the panel was closed.
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setFailed(false);
    try {
      const token = await getToken();
      if (!token) {
        if (request === requestRef.current) setFailed(true);
        return;
      }
      const res = await fetch(
        `${API_URL}/listings/${encodeURIComponent(listingId)}/interest`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        },
      );
      if (!res.ok) {
        if (request === requestRef.current) setFailed(true);
        return;
      }
      const body = (await res.json()) as InterestData;
      if (request === requestRef.current) setData(body);
    } catch {
      if (request === requestRef.current) setFailed(true);
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [getToken, listingId]);

  // Opening always refetches — the seller may be looking at a number that
  // moved since the last time they opened this panel.
  const openPanel = useCallback(() => {
    const isPhone =
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 639px)').matches;
    setPhone(isPhone);

    if (!isPhone && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      const width = Math.min(PANEL_WIDTH, window.innerWidth - 16);
      const spaceBelow = window.innerHeight - r.bottom;
      // 230px of panel is about the buy-now height; going above keeps it
      // inside the viewport when the card is near the bottom.
      const above = spaceBelow < 230 && r.top > spaceBelow;
      const left = Math.min(
        Math.max(8, r.left + r.width / 2 - width / 2),
        window.innerWidth - width - 8,
      );
      setPos({
        left,
        top: above ? r.top - 8 : r.bottom + 8,
        above,
        width,
      });
    }
    setOpen(true);
    void load();
  }, [load]);

  const close = useCallback(() => {
    setOpen(false);
    // Invalidate any in-flight request so a slow response cannot reopen state.
    requestRef.current++;
    buttonRef.current?.focus();
  }, []);

  const toggle = useCallback(
    (e: React.MouseEvent) => {
      // The card may one day be wrapped in a link — the ⓘ is not a navigation.
      e.preventDefault();
      e.stopPropagation();
      if (open) close();
      else openPanel();
    },
    [close, open, openPanel],
  );

  // Escape + outside-click + scroll/resize dismissal. The panel is fixed and
  // anchored to the button, so once the page moves it would be pointing at the
  // wrong thing — close rather than track.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    function onPointer(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      close();
    }
    function onMove() {
      close();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [close, open]);

  // Focus moves into the panel when it opens, so a keyboard user lands on the
  // content (and the close button) instead of tabbing from the trigger.
  // useEffect, not useLayoutEffect: this component is pre-rendered on the
  // server as part of the /my/listings page, and a layout effect there logs a
  // React warning while buying nothing — the panel does not exist until the
  // click, so there is no layout to measure.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
  }, [open]);

  const rows = data
    ? ([
        { label: 'Views', counter: data.views },
        { label: 'Saved', counter: data.saves },
        { label: 'Offers', counter: data.offers },
        { label: 'Questions', counter: data.questions },
        ...(data.listingType === 'AUCTION'
          ? [
              { label: 'Bids', counter: data.bids },
              { label: 'Watching', counter: data.watchers },
            ]
          : []),
      ] as { label: string; counter: Counter }[])
    : [];

  const panel = open ? (
    <>
      {phone && (
        <div
          aria-hidden
          onClick={close}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: Z_SCRIM,
            background: 'rgba(0,0,0,0.35)',
          }}
        />
      )}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={phone ? true : undefined}
        aria-label="Listing interest"
        tabIndex={-1}
        style={
          phone
            ? {
                position: 'fixed',
                zIndex: Z_SHEET,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'var(--bg-card)',
                borderTop: '0.5px solid var(--border)',
                borderRadius: '14px 14px 0 0',
                padding: '16px 16px calc(16px + env(safe-area-inset-bottom))',
                boxShadow: '0 -12px 32px rgba(0,0,0,0.35)',
              }
            : {
                position: 'fixed',
                zIndex: Z_POPOVER,
                left: pos?.left ?? 8,
                top: pos?.top ?? 8,
                width: pos?.width ?? PANEL_WIDTH,
                transform: pos?.above ? 'translateY(-100%)' : undefined,
                background: 'var(--bg-card)',
                border: '0.5px solid var(--border)',
                borderRadius: 10,
                boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
                padding: '12px 14px',
              }
        }
      >
        <div className="flex items-center justify-between mb-2">
          <h2
            className="text-sm font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            Listing interest
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close listing interest"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-tertiary)',
              fontSize: 16,
              lineHeight: 1,
              padding: '4px 6px',
            }}
          >
            ✕
          </button>
        </div>

        {!data && loading && (
          <p className="text-xs py-4" style={{ color: 'var(--text-tertiary)' }}>
            Loading…
          </p>
        )}

        {!data && failed && (
          <div className="py-2">
            <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
              We couldn&apos;t load this listing&apos;s interest.
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className="text-xs px-3 py-1.5 rounded-[6px]"
              style={{
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        )}

        {data && (
          <>
            <table
              className="w-full text-xs"
              style={{ color: 'var(--text-secondary)', borderCollapse: 'collapse' }}
            >
              <thead>
                <tr>
                  <th scope="col" style={{ textAlign: 'left', paddingBottom: 4 }} />
                  <th
                    scope="col"
                    style={{
                      textAlign: 'right',
                      paddingBottom: 4,
                      fontWeight: 500,
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    Total
                  </th>
                  <th
                    scope="col"
                    style={{
                      textAlign: 'right',
                      paddingBottom: 4,
                      fontWeight: 500,
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    Last 7 days
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label}>
                    <th
                      scope="row"
                      style={{
                        textAlign: 'left',
                        padding: '3px 0',
                        fontWeight: 400,
                        color: 'var(--text-primary)',
                      }}
                    >
                      {row.label}
                      {row.label === 'Offers' && data.offers.open > 0 && (
                        <span style={{ color: 'var(--text-tertiary)' }}>
                          {' '}
                          ({data.offers.open} open)
                        </span>
                      )}
                    </th>
                    <td
                      style={{
                        textAlign: 'right',
                        padding: '3px 0',
                        fontVariantNumeric: 'tabular-nums',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {fmt(row.counter.total)}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        padding: '3px 0',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {fmt(row.counter.last7d)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p
              className="text-[11px] mt-3"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Live for {data.liveSinceDays}{' '}
              {data.liveSinceDays === 1 ? 'day' : 'days'}. Views are page
              opens, not people.
            </p>

            {failed && (
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                Showing the last figures we loaded.
              </p>
            )}
          </>
        )}
      </div>
    </>
  ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="See how much interest this listing has generated"
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 7px',
          borderRadius: 6,
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-secondary)',
          fontSize: 11,
          fontWeight: 500,
          lineHeight: 1,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="8" cy="4.7" r="0.85" fill="currentColor" />
          <rect x="7.25" y="6.6" width="1.5" height="5.2" rx="0.6" fill="currentColor" />
        </svg>
        Interest
      </button>

      {typeof document !== 'undefined' && panel
        ? createPortal(panel, document.body)
        : null}
    </>
  );
}
