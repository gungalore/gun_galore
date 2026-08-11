import type { AskGgPageContext } from './use-ask-gg';

// Ask Boet Everywhere (W4 / F5) — derive the page context the panel sends
// with each message, purely from the URL. The backend treats these ids
// as UNTRUSTED hints: it re-fetches everything server-side with
// ownership checks, so nothing here is load-bearing for privacy — it
// only has to be honest about what page the user is on.
//
// Order matters: /listings/new must match BEFORE /listings/:id.

export type AskGgPageKind =
  | 'listing'
  | 'sell-form'
  | 'browse'
  | 'category'
  | 'order'
  | 'orders'
  | 'transaction'
  | 'cart'
  | 'wishlist'
  | 'subscribe'
  | 'dashboard'
  | 'swaps'
  | 'earnings'
  | 'saved-searches'
  | 'help'
  | 'home'
  | 'other';

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function derivePageContext(pathname: string | null): {
  kind: AskGgPageKind;
  ctx: AskGgPageContext;
} {
  const path = pathname && pathname.startsWith('/') ? pathname : '/';
  const ctx: AskGgPageContext = { path };
  const seg = path.split('/').filter(Boolean);

  if (path === '/') return { kind: 'home', ctx };
  if (path === '/listings/new') return { kind: 'sell-form', ctx };
  if (seg[0] === 'listings' && seg.length === 2 && ID_RE.test(seg[1])) {
    ctx.listingId = seg[1];
    return { kind: 'listing', ctx };
  }
  if (seg[0] === 'listings') return { kind: 'browse', ctx };
  if (seg[0] === 'category' && seg.length === 2 && ID_RE.test(seg[1])) {
    ctx.categorySlug = seg[1];
    return { kind: 'category', ctx };
  }
  if (seg[0] === 'orders' && seg.length === 2 && ID_RE.test(seg[1])) {
    ctx.orderId = seg[1];
    return { kind: 'order', ctx };
  }
  if (seg[0] === 'transactions' && seg.length === 2 && ID_RE.test(seg[1])) {
    ctx.transactionId = seg[1];
    return { kind: 'transaction', ctx };
  }
  if (
    seg[0] === 'orders' ||
    (seg[0] === 'my' && ['orders', 'sales', 'offers', 'bids'].includes(seg[1]))
  ) {
    return { kind: 'orders', ctx };
  }
  if (seg[0] === 'my' && seg[1] === 'swaps') return { kind: 'swaps', ctx };
  if (seg[0] === 'my' && seg[1] === 'earnings') {
    return { kind: 'earnings', ctx };
  }
  if (seg[0] === 'cart' || seg[0] === 'checkout') return { kind: 'cart', ctx };
  if (seg[0] === 'wishlist') return { kind: 'wishlist', ctx };
  if (seg[0] === 'subscribe') return { kind: 'subscribe', ctx };
  if (seg[0] === 'dashboard') return { kind: 'dashboard', ctx };
  if (seg[0] === 'saved-searches') return { kind: 'saved-searches', ctx };
  if (seg[0] === 'faq' || seg[0] === 'how-selling-works') {
    return { kind: 'help', ctx };
  }
  return { kind: 'other', ctx };
}

// Contextual starter chips — same {title, prompt} shape as
// GENERIC_STARTER_PROMPTS; the panel falls back to the generic trio for
// kinds not listed here.
export const CONTEXTUAL_STARTER_PROMPTS: Partial<
  Record<AskGgPageKind, { title: string; prompt: string }[]>
> = {
  listing: [
    {
      title: 'Is this a fair price?',
      prompt: 'Is this listing fairly priced? Check it against sold comparables for me.',
    },
    {
      title: 'What will shipping cost?',
      prompt: 'What would shipping cost me for this item, and which options are available?',
    },
    {
      title: 'What else do I need?',
      prompt: 'If I buy this, what accessories or extras should I get with it? Only suggest items actually for sale on All Outdoor.',
    },
  ],
  'sell-form': [
    {
      title: 'Help me write my listing',
      prompt: 'Help me write a good title and description for the item I am listing.',
    },
    {
      title: 'What fees will I pay?',
      prompt: 'What fees will I pay when my item sells, and what will I take home?',
    },
    {
      title: 'How should I price it?',
      prompt: 'How should I decide on an asking price for my item?',
    },
  ],
  order: [
    {
      title: "What's the status here?",
      prompt: 'Explain the current status of this order and what happens next.',
    },
    {
      title: 'Track my delivery',
      prompt: 'How do I track the delivery for this order?',
    },
    {
      title: 'How do refunds work?',
      prompt: 'If something goes wrong with this order, how do refunds and disputes work?',
    },
  ],
  transaction: [
    {
      title: "What's the status here?",
      prompt: 'Explain the current status of this transaction and what happens next.',
    },
    {
      title: 'When is payout?',
      prompt: 'When does the payment get released for this transaction?',
    },
    {
      title: 'How do disputes work?',
      prompt: 'If something is wrong with this transaction, how do I raise a dispute?',
    },
  ],
  orders: [
    {
      title: 'Track an order',
      prompt: 'How do I track my orders and deliveries on All Outdoor?',
    },
    {
      title: 'When do sellers get paid?',
      prompt: 'When does a seller get paid out after a sale?',
    },
    {
      title: 'How do returns work?',
      prompt: 'How do returns, refunds and disputes work?',
    },
  ],
  cart: [
    {
      title: 'How does payment work?',
      prompt: 'How does payment work at checkout, and when is my money released to the seller?',
    },
    {
      title: 'Shipping options?',
      prompt: 'What shipping options are there and what do they cost?',
    },
    {
      title: 'Buying from multiple sellers',
      prompt: 'How does buying from multiple sellers in one cart work?',
    },
  ],
  category: [
    {
      title: 'What should I look for?',
      prompt: 'What should I look for when buying in this category? Key specs and common mistakes.',
    },
    {
      title: "What's a fair price here?",
      prompt: 'What are fair price ranges in this category on the second-hand market?',
    },
    {
      title: 'Show me good options',
      prompt: 'What are some good options for sale in this category right now?',
    },
  ],
};
