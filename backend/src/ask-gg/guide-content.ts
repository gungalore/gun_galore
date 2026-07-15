// GG site-guide (G2) — the curated "how this page works / how to do well here"
// playbook library. 100% static content + (in the service) live DB state:
// ZERO Claude calls. This is what makes GG an always-on guide without burning
// AI credits.
//
// House rules: never the word "escrow" (say "payment held" / "funds held");
// usernames only, never real names; reference only REAL platform features.
// Each guide is short + skimmable; CTAs are either an internal deep-link
// (href) or a staged Ask-GG prompt (ask — nothing sends until the user does).

export interface GuideCta {
  label: string;
  /** Internal deep-link (relative, '/'-prefixed). Rendered as a nav button. */
  href?: string;
  /** A question staged into the composer when tapped (never auto-sent). */
  ask?: string;
}

export interface AskGgGuide {
  /** Resolved guide key (page-kind + sub-state). */
  key: string;
  title: string;
  /** One-line lead. The service fills this with LIVE state for auctions. */
  intro?: string;
  /** The tips / steps — the meat of the guide. */
  points: string[];
  ctas?: GuideCta[];
}

// Keyed by resolved guide key. The service picks the key from the page kind +
// (for listings) the listing type, then clones + injects live state.
export const GUIDES: Record<string, AskGgGuide> = {
  home: {
    key: 'home',
    title: 'Welcome — here’s how Gun Galore works',
    intro:
      'A South African marketplace for firearms, hunting, shooting, fishing, camping and the outdoors — with your payment protected on every deal.',
    points: [
      'Browse or search for anything outdoors. Every buy is protected: your payment is held until you’ve got the item.',
      'Four ways to buy: Buy Now, make an offer (Take a Shot), bid in an Auction, or Swop an item you own.',
      'Selling is free to list — you only pay a commission when it sells.',
      'Firearms are fully legal here: every firearm sale completes through a licensed-dealer transfer.',
      'Stuck? I’m on every page — ask me anything about the site, your orders, or the gear itself.',
    ],
    ctas: [
      { label: 'How does buying work?', ask: 'Walk me through buying something on Gun Galore from start to finish, including how my payment is protected.' },
      { label: 'Start selling', href: '/listings/new' },
      { label: 'Browse the marketplace', href: '/listings' },
    ],
  },

  browse: {
    key: 'browse',
    title: 'Finding what you want',
    points: [
      'Use the filters — price range, brand/make and category — to narrow things fast.',
      'Tell me what you’re after in plain words and I’ll search the marketplace for you.',
      'Save a search and get notified when a matching item is listed.',
      'Can’t find it? Post a Wanted ad — sellers with a match come to you. It’s free.',
    ],
    ctas: [
      { label: 'Find something for me', ask: 'Help me find ' },
      { label: 'Post a Wanted ad', href: '/wanted/new' },
    ],
  },

  category: {
    key: 'category',
    title: 'Buying in this category',
    points: [
      'Check the key specs that matter for this kind of item before you commit — I can tell you what to look for.',
      'Compare a few options on condition and price rather than grabbing the first one.',
      'Ask me for a fair second-hand price range so you know a good deal when you see one.',
    ],
    ctas: [
      { label: 'What should I look for?', ask: 'What should I look for when buying in this category — key specs and common mistakes?' },
      { label: 'Fair price range?', ask: 'What is a fair second-hand price range in this category?' },
    ],
  },

  'listing-buy-now': {
    key: 'listing-buy-now',
    title: 'Buying this item',
    points: [
      'Buy Now locks it in at the listed price. Prefer to haggle? Some sellers accept an offer — “Take a Shot”.',
      'Your payment is held safely and only released to the seller once you’ve received the item.',
      'Check the shipping options and cost before you commit — I can work it out for you.',
      'Ask me if the price is fair (I check it against real sold comparables) and what accessories pair well with it.',
    ],
    ctas: [
      { label: 'Is this a fair price?', ask: 'Is this listing fairly priced? Check it against sold comparables for me.' },
      { label: 'What will shipping cost?', ask: 'What would shipping cost me for this item, and which options are available?' },
      { label: 'What else do I need?', ask: 'If I buy this, what accessories or extras should I get with it? Only suggest items actually for sale on Gun Galore.' },
    ],
  },

  'listing-auction': {
    key: 'listing-auction',
    title: 'How to win this auction',
    points: [
      'Bidding: enter any amount at or above the next minimum. You can bid again any time before it ends.',
      'Set an auto-bid (your maximum) — I then bid the smallest amount needed to keep you in front, up to your max. No need to sit and watch the clock.',
      'No last-second snipes: a bid in the final moments extends the clock, so you always get a chance to respond. Set your true max early and let it run.',
      'Reserve: some auctions have a hidden minimum. If it shows “reserve not met”, even the top bid won’t win until it’s cleared — keep bidding to reach it.',
      'When it ends, the highest qualifying bid wins and pays through normal checkout, with your payment held until delivery. Firearms complete via a licensed-dealer transfer.',
    ],
    ctas: [
      { label: 'How does auto-bidding work?', ask: 'How exactly does auto-bidding (setting a maximum) work on a Gun Galore auction, and how does it help me win?' },
      { label: 'Explain the reserve', ask: 'What is a reserve price on this auction and how do I know if it has been met?' },
    ],
  },

  'listing-swop': {
    key: 'listing-swop',
    title: 'How a Swop works',
    points: [
      'Propose a straight swap of your item for this one — add cash either way if the values differ.',
      'Both sides ship through the platform and both items are checked before anything is released, so neither of you is left empty-handed.',
      'There’s a small flat fee per side to cover the managed shipping — no commission on the item value.',
      'Firearm swaps still route each firearm through a licensed dealer.',
    ],
    ctas: [
      { label: 'Walk me through a swop', ask: 'Walk me through how a Swop works on Gun Galore from proposal to completion.' },
    ],
  },

  'listing-take-a-shot': {
    key: 'listing-take-a-shot',
    title: 'Making an offer',
    points: [
      'This seller takes offers — name your price and they can accept, decline or counter.',
      'Keep it reasonable: a fair offer with a note about why lands far better than a lowball.',
      'If they accept, you pay through normal checkout with your payment held until delivery.',
    ],
    ctas: [
      { label: 'What should I offer?', ask: 'What is a sensible offer to make on this item, and how does the offer process work?' },
    ],
  },

  'listing-experience': {
    key: 'listing-experience',
    title: 'Booking this experience',
    points: [
      'This is a booked on-site experience (a guided hunt or range day), not a shipped item.',
      'Your payment is held until the booking is honoured, so you’re protected if plans change.',
      'Cancellation terms follow the Consumer Protection Act — ask me how refunds work before you book.',
    ],
    ctas: [
      { label: 'How do cancellations work?', ask: 'How do cancellations and refunds work for a booked experience or hunt?' },
    ],
  },

  'sell-form': {
    key: 'sell-form',
    title: 'Listing your item well',
    points: [
      'Good photos + an honest, specific description sell faster and for more. I can draft the title and description for you.',
      'Price it right: ask me for a suggested price based on what similar items actually sold for.',
      'Pick your selling mode — Buy Now for a quick sale, Auction to let the market decide, Take a Shot to invite offers, or Swop to trade.',
      'Listing is free — you only pay a commission when it sells.',
      'Firearms: you’ll add the serial, a licence photo, and where you’ll dealer-stock it (dealer name, province, area) — all required and verified.',
    ],
    ctas: [
      { label: 'Write my listing', ask: 'Help me write a strong title and description for the item I am listing.' },
      { label: 'How should I price it?', ask: 'How should I decide on an asking price, and what will I take home after fees?' },
    ],
  },

  cart: {
    key: 'cart',
    title: 'Checking out safely',
    points: [
      'Your payment is held by the platform and only released to the seller once you confirm you’ve received the item — that’s your protection.',
      'Buying from several sellers in one go is fine; each seller ships their part and you’re covered on each.',
      'Check the shipping method and cost per item before you pay.',
      'If anything goes wrong, you can raise a dispute and I’ll walk you through refunds.',
    ],
    ctas: [
      { label: 'How is my payment protected?', ask: 'How does payment protection work at checkout, and when is my money released to the seller?' },
      { label: 'What are the shipping options?', ask: 'What shipping options are available and what do they cost?' },
    ],
  },

  order: {
    key: 'order',
    title: 'Tracking this order',
    points: [
      'Follow the status here: paid → accepted → dispatched → in transit → delivered.',
      'Once it’s delivered and you’re happy, confirm delivery — that releases payment to the seller.',
      'Something off? Don’t confirm delivery — raise a dispute instead and I’ll help.',
    ],
    ctas: [
      { label: 'Where’s my order?', ask: 'What is the current status of this order and what happens next?' },
      { label: 'How do refunds work?', ask: 'If something goes wrong with this order, how do refunds and disputes work?' },
    ],
  },

  transaction: {
    key: 'transaction',
    title: 'Your sale — what happens now',
    points: [
      'Accept the sale, then dispatch within the deadline shown so the buyer isn’t left waiting.',
      'Add the tracking reference when you dispatch — the buyer (and I) can then follow it.',
      'Your payout is released after the buyer receives the item; it needs your KYC and banking done first.',
    ],
    ctas: [
      { label: 'What do I do next?', ask: 'Explain the current status of this sale and exactly what I need to do next.' },
      { label: 'When do I get paid?', ask: 'When does the payment get released to me for this sale, and what has to be in place first?' },
    ],
  },

  orders: {
    key: 'orders',
    title: 'Your orders & sales',
    points: [
      'Track deliveries, respond to offers, and see what needs your attention in one place.',
      'As a seller you get paid out after the buyer confirms delivery — keep your KYC and banking up to date so payouts aren’t held.',
      'Ask me for a quick update on anything here.',
    ],
    ctas: [
      { label: 'Update me on my orders', ask: 'Give me an update on my recent orders and anything that needs my attention.' },
    ],
  },

  wanted: {
    key: 'wanted',
    title: 'Wanted ads',
    points: [
      'Looking for something that isn’t listed? Post what you want and sellers with a match respond to you.',
      'It’s free to post — no upfront fees to advertise.',
      'When a seller responds with a matching item, you buy it through the normal protected checkout.',
    ],
    ctas: [
      { label: 'Post a Wanted ad', href: '/wanted/new' },
      { label: 'How do Wanted ads work?', ask: 'How do Wanted ads work — posting one, and what happens when a seller responds?' },
    ],
  },

  competitions: {
    key: 'competitions',
    title: 'Raffles & competitions',
    points: [
      'Enter to win with paid tickets — or use the free entry route where one is offered (no purchase necessary).',
      'Winners are drawn fairly and the draw is verifiable.',
      'Some competitions are perks for GG+ members.',
    ],
    ctas: [
      { label: 'How do raffles work?', ask: 'How do the raffles and competitions work, including the free entry route and how winners are drawn?' },
      { label: 'See GG+ perks', href: '/subscribe' },
    ],
  },

  help: {
    key: 'help',
    title: 'Getting help',
    points: [
      'Most answers are instant — ask me anything about the site, fees, shipping, firearms, or your account.',
      'If you need a human, I can draft a support ticket for you to send with one tap.',
    ],
    ctas: [
      { label: 'Ask a question', ask: '' },
    ],
  },

  generic: {
    key: 'generic',
    title: 'I’m your guide here',
    points: [
      'I’m on every page — ask me how anything works, and I can look up your own orders, sales and offers.',
      'Buying is protected end to end: your payment is held until you’ve got the item.',
      'Selling is free to list; firearms complete through a licensed-dealer transfer.',
    ],
    ctas: [
      { label: 'What can you do?', ask: 'What can you help me with on Gun Galore?' },
    ],
  },
};
