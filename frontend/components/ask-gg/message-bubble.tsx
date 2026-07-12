'use client';

import Link from 'next/link';
import type {
  AskGgUiMessage,
  AskGgCitation,
  AskGgListingCard,
} from '@/lib/use-ask-gg';
import { AssistantMarkdown } from './assistant-markdown';
import { IconRefresh } from './icons';

export function MessageBubble({
  message,
  onEscalate,
  priorUserContent,
}: {
  message: AskGgUiMessage;
  onEscalate: (content: string) => void;
  priorUserContent: string | null;
}) {
  const isUser = message.role === 'user';
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 10,
      }}
    >
      <div
        style={{
          maxWidth: '85%',
          padding: '10px 14px',
          borderRadius: 14,
          background: isUser ? 'var(--red)' : 'var(--bg-card)',
          color: isUser ? '#fff' : 'var(--text-primary)',
          border: isUser ? 'none' : '0.5px solid var(--border)',
          opacity: message.pending ? 0.6 : 1,
          fontSize: 14,
          lineHeight: 1.5,
          // User bubbles keep simple pre-wrap (no markdown rendered for
          // user input). Assistant bubbles render markdown via
          // ReactMarkdown — the component takes over whitespace handling
          // so we DON'T set pre-wrap on the container.
          whiteSpace: isUser ? 'pre-wrap' : 'normal',
          wordBreak: 'break-word',
        }}
      >
        {/* User-attached photos render as thumbnails ABOVE the text
            content so the visual context is clear before reading the
            question. Assistant messages never carry imageUrls. */}
        {isUser && message.imageUrls && message.imageUrls.length > 0 && (
          <UserPhotosRow urls={message.imageUrls} />
        )}
        {isUser ? (
          message.content
        ) : (
          <AssistantMarkdown content={message.content} />
        )}
        {!isUser && message.citations && message.citations.length > 0 && (
          <CitationsRow citations={message.citations} />
        )}
        {!isUser && message.listingCards && message.listingCards.length > 0 && (
          <ListingCardsRow cards={message.listingCards} />
        )}
        {!isUser && priorUserContent && (
          <div
            style={{
              marginTop: 10,
              paddingTop: 10,
              borderTop: '0.5px solid var(--border)',
              display: 'flex',
              justifyContent: 'flex-end',
            }}
          >
            <button
              type="button"
              onClick={() => onEscalate(priorUserContent)}
              title="Re-ask with a deeper model"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 6,
                background: 'transparent',
                color: 'var(--text-tertiary)',
                border: '0.5px solid var(--border)',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              <IconRefresh />
              Try again with deeper thinking
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Thumbnail strip of photos a user attached to their message.
 *  Each thumbnail is clickable — opens the full image in a new tab.
 *  Caps visual height so a 5-photo message doesn't dwarf the text. */
export function UserPhotosRow({ urls }: { urls: string[] }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        marginBottom: urls.length > 0 ? 8 : 0,
      }}
    >
      {urls.map((url, i) => (
        <a
          key={i}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'block',
            width: 80,
            height: 80,
            borderRadius: 8,
            overflow: 'hidden',
            border: '0.5px solid rgba(255,255,255,0.20)',
            background: 'rgba(0,0,0,0.3)',
          }}
          aria-label={`Open photo ${i + 1} in new tab`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={`Attached photo ${i + 1}`}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        </a>
      ))}
    </div>
  );
}

/** Citation chips rendered below an assistant message. Each chip
 *  shows the manual + page(s) Claude actually read while answering.
 *  Plain visible footer — no hyperlinks (PDFs are admin-only). The
 *  manual name is enough proof that the answer came from a real
 *  manufacturer source. */
export function CitationsRow({ citations }: { citations: AskGgCitation[] }) {
  return (
    <div
      style={{
        marginTop: 10,
        paddingTop: 10,
        borderTop: '0.5px solid var(--border)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
      }}
    >
      <span
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          color: 'var(--text-tertiary)',
          alignSelf: 'center',
          marginRight: 4,
        }}
      >
        Sources
      </span>
      {citations.map((c, i) => {
        const chipStyle = {
          display: 'inline-flex' as const,
          alignItems: 'center' as const,
          gap: 4,
          padding: '3px 9px',
          borderRadius: 999,
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-secondary)',
          fontSize: 11,
          lineHeight: 1.3,
        };
        // Web (forum/maker) source → clickable link chip.
        if (c.sourceType === 'web' && c.url) {
          let host = c.url;
          try {
            host = new URL(c.url).hostname.replace(/^www\./, '');
          } catch {
            /* leave host as the raw url */
          }
          const label =
            c.title.length > 46 ? `${c.title.slice(0, 46)}…` : c.title;
          return (
            <a
              key={`web-${i}`}
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`${c.title} — ${c.url}`}
              style={{ ...chipStyle, textDecoration: 'none' }}
            >
              💬 {label} · {host} ↗
            </a>
          );
        }
        // Manual source → plain (non-link) chip.
        const pages = c.pages ?? [];
        return (
          <span
            key={`man-${c.manualId ?? i}`}
            title={`${c.manufacturer ?? ''} — ${c.title}${
              c.edition ? ` (${c.edition})` : ''
            }${
              pages.length
                ? `, page${pages.length > 1 ? 's' : ''} ${pages.join(', ')}`
                : ''
            }`}
            style={chipStyle}
          >
            {c.manufacturer ? `${c.manufacturer} ` : ''}
            {c.title}
            {c.edition ? ` (${c.edition})` : ''}
            {pages.length
              ? ` · p.${pages.length === 1 ? pages[0] : pages.join(',')}`
              : ''}
          </span>
        );
      })}
    </div>
  );
}

/** P2.2 — live marketplace listings the answer surfaced (searchMarketplace
 *  / getComplements). A horizontal strip of tappable cards under the
 *  assistant message; each links to the listing so a gear answer becomes
 *  shoppable. Prices are ZAR cents; auction / take-a-shot / swap have no
 *  fixed price so we show the mode instead. */
export function ListingCardsRow({ cards }: { cards: AskGgListingCard[] }) {
  const priceLabel = (c: AskGgListingCard): string => {
    if (typeof c.priceCents === 'number') {
      return `R${Math.round(c.priceCents / 100).toLocaleString('en-ZA')}`;
    }
    if (c.listingType === 'AUCTION') return 'Auction';
    if (c.listingType === 'TAKE_A_SHOT') return 'Take a Shot';
    if (c.listingType === 'SWOP') return 'Swap';
    return 'See listing';
  };
  return (
    <div
      style={{
        marginTop: 10,
        paddingTop: 10,
        borderTop: '0.5px solid var(--border)',
      }}
    >
      <span
        style={{
          display: 'block',
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          color: 'var(--text-tertiary)',
          marginBottom: 6,
        }}
      >
        On Gun Galore now
      </span>
      <div
        style={{
          display: 'flex',
          gap: 8,
          overflowX: 'auto',
          paddingBottom: 4,
          scrollbarWidth: 'thin',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {cards.map((c) => (
          <Link
            key={c.id}
            href={`/listings/${c.id}`}
            style={{
              flex: '0 0 auto',
              width: 142,
              textDecoration: 'none',
              color: 'inherit',
              border: '0.5px solid var(--border)',
              borderRadius: 10,
              overflow: 'hidden',
              background: 'var(--bg-card)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                width: '100%',
                height: 100,
                background: 'var(--bg-inset)',
                position: 'relative',
              }}
            >
              {c.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.imageUrl}
                  alt={c.title}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  loading="lazy"
                />
              ) : (
                <span
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    color: 'var(--text-tertiary)',
                  }}
                >
                  No photo
                </span>
              )}
            </div>
            <div style={{ padding: '7px 8px 9px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span
                style={{
                  fontSize: 12,
                  lineHeight: 1.25,
                  color: 'var(--text-primary)',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {c.title}
              </span>
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: 'var(--red)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {priceLabel(c)}
              </span>
              {(c.condition || c.province) && (
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                  {[c.condition?.replace(/_/g, ' '), c.province?.replace(/_/g, ' ')]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Finds the user message that preceded the given assistant message —
 *  the content the "Try again with deeper thinking" button re-asks. */
export function priorUserContent(
  messages: AskGgUiMessage[],
  assistantId: string,
): string | null {
  const idx = messages.findIndex((m) => m.id === assistantId);
  if (idx < 1) return null;
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return null;
}
