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

/** G4 personal overlay — how urgent/important a personal item is. Drives the
 *  chip colour in the Guide tab; NOT a security boundary. */
export type GuidePersonalTone = 'action' | 'info' | 'good';

export interface GuidePersonalItem {
  /** Already-shaped, PII-safe one-liner (usernames only, no bank/PIN/address —
   *  produced by the whitelist-by-construction account shapers). */
  label: string;
  /** Deep-link to the real page where any sensitive detail legitimately lives. */
  href?: string;
  tone?: GuidePersonalTone;
}

/** G4 — a signed-in user's own top-of-mind state for THIS page, composed
 *  server-side from the read-only, PII-gated account shapers. $0 AI. Omitted
 *  entirely when there is nothing worth showing (guide, not nag). */
export interface GuidePersonal {
  headline: string;
  items: GuidePersonalItem[];
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
  /** G4 — the authed personal overlay (only on /ask-gg/guide, never the
   *  public endpoint). Filled by AskGgGuideService.getPersonalGuide. */
  personal?: GuidePersonal;
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
    ],
    ctas: [
      { label: 'Find something for me', ask: 'Help me find ' },
      { label: 'Save this search', ask: 'How do I save a search and get alerts when a matching item is listed?' },
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

  // ── Account & personal surfaces (G4) ────────────────────────────────
  dashboard: {
    key: 'dashboard',
    title: 'Your seller dashboard',
    points: [
      'This is your seller standing — your tier, trust score and what’s left to reach the next level.',
      'A higher seller tier earns real perks: lower commission once you reach Top Seller, and more trust with buyers. (Featured-slot discounts are a separate GG+ membership perk.)',
      'Keep deliveries on time, your ratings up, and KYC + banking complete — that’s what moves the score.',
      'Buyers can ask questions on your listings; answering quickly builds trust and sales.',
    ],
    ctas: [
      { label: 'How do I level up my tier?', ask: 'How do the seller tiers work and what do I need to do to reach the next one?' },
      { label: 'My earnings', href: '/my/earnings' },
    ],
  },

  profile: {
    key: 'profile',
    title: 'Your account',
    points: [
      'Everything about your account lives here — your profile, GG+ tier, identity check and account tasks.',
      'Completing your profile (including banking) and passing the live ID check unlocks selling payouts.',
      'Your username is all other members ever see — never your real name or contact details.',
      'Ask me any time to check your orders, sales, offers or what needs your attention.',
    ],
    ctas: [
      { label: 'What needs my attention?', ask: 'What on my account needs my attention right now?' },
      { label: 'Settings', href: '/settings' },
    ],
  },

  settings: {
    key: 'settings',
    title: 'Settings & details',
    points: [
      'Manage your saved delivery addresses, banking for payouts, and notification preferences here.',
      'Sellers: your payout banking must be in your own name — we check the name matches your ID before the first payout.',
      'Set a default address to speed up checkout.',
      'Your banking details are only ever shown to you — I never handle or repeat them.',
    ],
    ctas: [
      { label: 'Why do you need my banking?', ask: 'Why does Gun Galore need my banking details, and how are they kept safe?' },
    ],
  },

  subscribe: {
    key: 'subscribe',
    title: 'GG+ membership',
    points: [
      'GG+ has two tiers — Member and Pro — with perks like more Ask GG advice, featured-slot discounts and bigger photo limits.',
      'It’s prepaid by EFT: no debit order, no auto-renew. You’re only ever charged when you choose to renew.',
      'Pro unlocks the most — including the reloading Load Lab and the deepest advice quota.',
      'Not sure it’s worth it? Ask me to compare the tiers against what you actually use.',
    ],
    ctas: [
      { label: 'Compare the tiers', ask: 'Compare the GG+ Member and Pro tiers and their perks — which suits me?' },
      { label: 'How does billing work?', ask: 'How does GG+ billing work — is it a subscription that auto-renews?' },
    ],
  },

  wishlist: {
    key: 'wishlist',
    title: 'Your wishlist',
    points: [
      'Items you’ve saved live here. Tap the heart on any listing to add it.',
      'It’s your shortlist for comparing before you commit — ask me to weigh two saved items against each other.',
      'Prices and availability can change, so grab a deal before it’s gone.',
    ],
    ctas: [
      { label: 'Compare my saved items', ask: 'Help me compare the items on my wishlist and decide which is the best buy.' },
      { label: 'Browse the marketplace', href: '/' },
    ],
  },

  'saved-searches': {
    key: 'saved-searches',
    title: 'Saved searches',
    points: [
      'Save any search and we’ll watch the marketplace for you — you get an alert when a new matching item is listed.',
      'It’s the fastest way to be first on a hard-to-find item without checking back every day.',
      'Toggle alerts on or off per search whenever you like.',
    ],
    ctas: [
      { label: 'How do alerts work?', ask: 'How do saved-search alerts work — when and how do I get notified?' },
    ],
  },

  notifications: {
    key: 'notifications',
    title: 'Your notifications',
    points: [
      'Your activity feed — offers, bids, dispatch updates, payout news and disputes all land here.',
      'Important events also reach you by SMS and email; you can tune which channels in Settings.',
      'Tap anything here to jump straight to the order, offer or listing it’s about.',
    ],
    ctas: [
      { label: 'Manage my alerts', href: '/settings' },
      { label: 'What needs my attention?', ask: 'What on my account needs my attention right now?' },
    ],
  },

  offers: {
    key: 'offers',
    title: 'Your offers & bids',
    points: [
      'Track offers you’ve made or received and your auction bids in one place.',
      'When an offer is accepted, pay through the normal protected checkout to lock it in before it expires.',
      'On auctions, set your maximum (auto-bid) and I’ll keep you in front up to that amount — no clock-watching.',
      'Received an offer as a seller? You can accept, decline or counter.',
    ],
    ctas: [
      { label: 'Update me on my offers', ask: 'Give me an update on my offers and bids and anything that needs my response.' },
      { label: 'How does auto-bidding work?', ask: 'How does setting a maximum auto-bid work, and how does it help me win?' },
    ],
  },

  'my-listings': {
    key: 'my-listings',
    title: 'Your listings',
    points: [
      'Manage everything you’re selling — live, sold and drafts — from here.',
      'Listing is free; you only pay commission when an item sells. Ask me what you’ll take home after fees.',
      'Better photos and an honest, specific description sell faster and for more — I can rewrite yours.',
      'Firearms need a serial, a licence photo and where you’ll dealer-stock it (dealer, province, area) before they go live.',
    ],
    ctas: [
      { label: 'List a new item', href: '/listings/new' },
      { label: 'What will I take home?', ask: 'For an item I’m selling, what fees apply and what will I take home?' },
    ],
  },

  swaps: {
    key: 'swaps',
    title: 'Your swaps',
    points: [
      'Follow each two-way trade here: proposal, both sides funding, proof-of-possession, shipping and completion.',
      'Both sides fund before anything ships — if only one side pays, that person is fully reimbursed, so no one is left out of pocket.',
      'You’ll be asked to photograph your item next to a unique code — that proves it exists before either item moves.',
      'Payment references and banking for a swap show on this page; I never handle those directly.',
    ],
    ctas: [
      { label: 'Walk me through a swop', ask: 'Walk me through how a Swop works from proposal to completion, including the photo step.' },
      { label: 'Update me on my swaps', ask: 'Give me an update on my swaps and what each one is waiting on.' },
    ],
  },

  earnings: {
    key: 'earnings',
    title: 'Your earnings & payouts',
    points: [
      'See your sales, commission, fees and net payout over any period here.',
      'Held funds release after the buyer confirms delivery, then pay out in the next business-day batch.',
      'Payouts need your identity check (KYC) done and your seller profile — including banking — complete.',
      'Ask me if anything is holding a payout back and exactly how to clear it.',
    ],
    ctas: [
      { label: 'Is anything blocking my payout?', ask: 'Is anything blocking my payouts right now, and how do I fix it?' },
      { label: 'When do I get paid?', ask: 'When does money release to me after a sale, and how does the payout timing work?' },
    ],
  },

  sellers: {
    key: 'sellers',
    title: 'About this seller',
    points: [
      'This is a seller’s storefront — their tier, ratings, badges and everything they have for sale.',
      'A Top Seller badge reflects a track record of good deals; a Verified Expert badge marks a recognised knowledge contributor.',
      'Every purchase from them is still protected: your payment is held until you’ve got the item.',
      'Ask me to check whether an item of theirs is fairly priced.',
    ],
    ctas: [
      { label: 'What do the badges mean?', ask: 'What do the seller tier and badges (Top Seller, Verified Expert) mean?' },
    ],
  },

  featured: {
    key: 'featured',
    title: 'Featuring your listing',
    points: [
      'Featured slots put your listing on prime real estate (like the homepage) for a set run.',
      'You bid for a slot — the top bid wins it for the slot’s duration. There’s a minimum bid per slot tier.',
      'GG+ members get a discount on featured bids — Pro more than Member.',
      'Featured-slot fees aren’t refundable once the slot runs, so bid what a burst of exposure is worth to you.',
    ],
    ctas: [
      { label: 'Is featuring worth it for me?', ask: 'How do featured slots work and is it worth featuring my listing?' },
    ],
  },

  'dealer-verification': {
    key: 'dealer-verification',
    title: 'Firearm stock-in verification',
    points: [
      'Every firearm sale completes through a licensed dealer. Here you upload the proof so payout can be released.',
      'Photograph the documents clearly — the SAP 534, the dealer’s stock register entry, and the firearm serial as asked.',
      'Blurry or partial photos get sent back; a clear, well-lit shot of the whole page passes first time.',
      'Once it’s approved, the buyer is notified and your payout is released.',
    ],
    ctas: [
      { label: 'What exactly do I upload?', ask: 'What documents and photos do I need to upload for firearm dealer-stock verification?' },
      { label: 'Why is this needed?', ask: 'Why does a firearm sale need dealer stock-in verification before payout?' },
    ],
  },

  legal: {
    key: 'legal',
    title: 'Policies & the fine print',
    points: [
      'All the official documents — Terms, Privacy, refunds, firearms compliance and more — are gathered here.',
      'Rather get the short version? Ask me and I’ll explain any policy in plain language.',
      'For firearm law or tax specifics I’ll point you to a dealer (DFO) or professional — I’m a guide, not legal advice.',
    ],
    ctas: [
      { label: 'Explain a policy for me', ask: 'Explain in plain language how ' },
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
