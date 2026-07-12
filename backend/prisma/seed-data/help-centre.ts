// Seeded Help-Centre entries for the Ask GG knowledge base.
// SINGLE SOURCE OF TRUTH for platform Q&A copy — edit here and rerun
// `npm run seed:help` (idempotent upsert on sourceKey). Authored from the
// live site copy (FAQ, how-selling-works, legal pages, fee calculator).

export interface HelpCentreSeedEntry {
  /** Stable unique key, kebab-case, prefixed by area: e.g. 'fees-commission-bands' */
  sourceKey: string;
  title: string; // short, user-facing ("What commission does Gun Galore charge?")
  question: string; // the question as a user would ask it
  answer: string; // the verified answer, plain text / light markdown, ≤900 chars
  tags: string[]; // 2-5 lowercase tags
}

export const HELP_CENTRE_ENTRIES: HelpCentreSeedEntry[] = [
  // ── Fees & payments ────────────────────────────────────────────────
  {
    sourceKey: 'fees-commission-bands',
    title: 'What commission does Gun Galore charge?',
    question: 'How much commission does Gun Galore take when I sell something?',
    answer:
      "Commission is charged only on a completed sale and works like tax brackets — each rate applies only to the rand inside its slice: 9% on the first R5,000, 7% on R5,001–R20,000, 5% on R20,001–R100,000, and 3% above R100,000. Example: a R8,000 sale = 9% of R5,000 (R450) + 7% of R3,000 (R210) = R660. A R30 minimum platform fee applies. The exact figure is always shown up front before you list — see [How selling works](/how-selling-works).",
    tags: ['fees', 'commission', 'selling'],
  },
  {
    sourceKey: 'fees-minimum-commission',
    title: 'Is there a minimum platform fee?',
    question: 'Why was I charged R30 commission on a small sale?',
    answer:
      'Yes — R30. The commission bands are applied first; if the result comes to less than R30 (which happens on small-ticket sales), the commission is bumped up to R30 to cover processing overhead. The minimum never exceeds the sale price itself, and the fee you will pay is shown before you list, so there are no surprises.',
    tags: ['fees', 'commission', 'minimum'],
  },
  {
    sourceKey: 'fees-top-seller-discount',
    title: 'What is the Top Seller discount?',
    question: 'Do Top Sellers pay less commission?',
    answer:
      "Yes. Top Sellers get 0.5% of the total sale price off their commission — on a R10,000 sale that is R50 off. It applies automatically once you hold Top Seller status, and the discounted figure shows in your fee preview when you list. The R30 minimum platform fee still applies.",
    tags: ['fees', 'commission', 'top seller'],
  },
  {
    sourceKey: 'fees-processing-fee',
    title: 'What is the payment processing fee?',
    question: 'Why is there a processing fee added at checkout?',
    answer:
      'A payment processing fee (currently 1.5% on EFT) covers the cost of moving your money. It is calculated on the item price plus shipping and shown at checkout before you pay. Depending on how the seller set up the listing, the fee is either added to the buyer total or absorbed by the seller — either way, the total you see at checkout is final, with no hidden charges.',
    tags: ['fees', 'payments', 'checkout'],
  },
  {
    sourceKey: 'fees-buyer-costs',
    title: 'What does it cost to buy?',
    question: 'Are there fees for buyers on Gun Galore?',
    answer:
      'Browsing and bidding are free. When you buy, your total is the item price + shipping (a live courier quote) + a payment processing fee (currently 1.5% on EFT) where the listing passes it to the buyer + a flat R15 shipping handling fee per courier parcel. Every line is itemised at checkout before you pay — no hidden charges.',
    tags: ['fees', 'buying', 'checkout'],
  },
  {
    sourceKey: 'fees-how-to-pay',
    title: 'How can I pay?',
    question: 'What payment methods does Gun Galore accept?',
    answer:
      'The available method is shown at checkout — currently manual EFT: you get Gun Galore banking details plus a unique payment reference, pay from your own bank, and the order confirms once the payment reconciles. Always use the exact reference so the payment matches automatically. Whichever method you use, your payment is held by Gun Galore and only released to the seller after delivery is confirmed.',
    tags: ['payments', 'eft', 'checkout'],
  },
  {
    sourceKey: 'fees-swap-fees',
    title: 'What does a Swop / Trade cost?',
    question: 'What are the fees on a swap?',
    answer:
      'A swap has no sale price, so instead of commission each party pays a flat service fee for the leg they send: R50 for a courier parcel (plus the actual courier rate for that parcel) or R100 for a firearm dealer-transfer leg. No processing fee is added on swap funding. If the deal includes a cash top-up, amounts up to R1,000 are commission-free; only the portion above R1,000 attracts the standard commission bands, deducted from the cash paid to the recipient at settlement. Both sides must fund before anything ships — if only one side funds, that member is fully reimbursed.',
    tags: ['fees', 'swap', 'trade'],
  },

  // ── Selling modes ──────────────────────────────────────────────────
  {
    sourceKey: 'sell-ways-to-sell',
    title: 'What are the ways to sell on Gun Galore?',
    question: 'Which selling formats can I choose?',
    answer:
      "Four: Marketplace (Buy Now) — one fixed price, the fastest way to sell; Auction — buyers bid and the highest bid at the deadline wins, with an optional hidden reserve; Take a Shot — buyers name their price and you accept, decline or counter; and Swop / Trade — trade your item for someone else's, with optional cash either way. Whichever you pick, listings are checked before going live and the buyer's payment is held until delivery is confirmed. Full guide: [How selling works](/how-selling-works).",
    tags: ['selling', 'auction', 'marketplace', 'swap'],
  },
  {
    sourceKey: 'sell-marketplace-buy-now',
    title: 'How does Marketplace (Buy Now) work?',
    question: 'How does a fixed-price listing work?',
    answer:
      'You set one price; the buyer taps Buy and pays — no waiting, no negotiation. The payment is held by Gun Galore until the buyer confirms delivery, then released to you less commission. Selling several identical units? Set a quantity when you list and the listing stays live until every unit is sold.',
    tags: ['selling', 'marketplace', 'buy now'],
  },
  {
    sourceKey: 'sell-auction-how',
    title: 'How do auctions work?',
    question: 'How do I run an auction on Gun Galore?',
    answer:
      'Set a duration and a starting bid when you list on the [Sell page](/sell). Buyers bid, and the highest bid when time runs out wins. You can set a hidden reserve to protect yourself — the item only sells if bidding reaches your minimum. Bidding is free; the winner pays and the money is held until they confirm delivery. Bids in the final 2 minutes extend the end time, so snipers cannot steal it at the last second.',
    tags: ['selling', 'auction', 'reserve'],
  },
  {
    sourceKey: 'sell-auction-anti-snipe',
    title: 'What stops last-second auction sniping?',
    question: 'What happens if someone bids in the final seconds of an auction?',
    answer:
      'Any bid placed in the final 2 minutes of an auction extends the end time by 2 minutes. That repeats for every late bid, so the auction only closes once bidding has genuinely gone quiet — nobody wins purely by sneaking a bid in at the last second, and every bidder gets a fair chance to respond.',
    tags: ['auction', 'sniping', 'bidding'],
  },
  {
    sourceKey: 'sell-take-a-shot',
    title: 'How does Take a Shot work?',
    question: 'What is a Take a Shot listing?',
    answer:
      "Take a Shot lets buyers name their price. A buyer sends you an offer; you can accept, decline, or counter once. You can also set an optional hidden auto-accept price — any offer at or above it closes the sale instantly. It suits items that are hard to price or where negotiation works better than a fixed price. As with every sale, payment is held until delivery is confirmed before it reaches you.",
    tags: ['selling', 'take a shot', 'offers'],
  },
  {
    sourceKey: 'sell-swop-trade',
    title: 'How does Swop / Trade work?',
    question: 'Can I trade my gear instead of selling it?',
    answer:
      "Yes. List the item you want to trade — no price. Other members propose a swap: their item, plus optional cash in either direction. You accept, decline, or counter the cash once. Gun Galore arranges both couriers and any cash is held until both parcels are delivered, then released. Firearms can be swapped too — each side transfers through a SAPS-licensed dealer, exactly like a normal firearm sale.",
    tags: ['swap', 'trade', 'selling'],
  },
  {
    sourceKey: 'sell-listing-review',
    title: 'Why is my listing not live yet?',
    question: 'Do listings get reviewed before they appear?',
    answer:
      "Every listing is checked before it goes live — that keeps prohibited items off the platform and protects buyers. Most listings clear quickly. Firearm listings also go through licence and serial verification, and a new seller's first few firearm listings receive a manual review. You are notified the moment it goes live, or if something needs fixing first.",
    tags: ['selling', 'listings', 'moderation'],
  },
  {
    sourceKey: 'sell-multiple-units',
    title: 'Can I sell more than one of the same item?',
    question: 'How do I list several identical units?',
    answer:
      'Yes — on a Marketplace (Buy Now) listing, set a quantity when you list. The listing stays live until every unit is sold and stock counts down automatically with each order. Firearms are always one per listing, because each firearm carries its own serial number and licence details. Auctions and Take a Shot are single-item formats.',
    tags: ['selling', 'inventory', 'quantity'],
  },

  // ── Buying & funds-held lifecycle ──────────────────────────────────
  {
    sourceKey: 'buy-payment-protection',
    title: 'How does payment protection work?',
    question: 'Is my money safe when I buy on Gun Galore?',
    answer:
      'When you pay, the funds are held by Gun Galore — the seller does not receive them yet. They are only released after you confirm delivery (or, for a firearm, after the dealer transfer is verified). If something goes wrong before then, you can raise a dispute and request a refund, so you are never out of pocket for an item that never arrives. Full detail: [Refund & Dispute Policy](/refund-policy).',
    tags: ['buying', 'payment held', 'protection'],
  },
  {
    sourceKey: 'buy-confirm-delivery',
    title: "What does 'Confirm delivery' do?",
    question: 'Should I confirm delivery as soon as my parcel arrives?',
    answer:
      "Inspect the item first. Confirming delivery releases the held payment to the seller immediately and is final — you cannot raise a dispute on the same issue afterwards. That is why it is a deliberate two-step flow with an inspection checklist. If the item is damaged, wrong, or missing anything, do not confirm — raise a dispute from the order page instead, and your payment stays held while it is reviewed.",
    tags: ['buying', 'delivery', 'confirm'],
  },
  {
    sourceKey: 'buy-raise-dispute',
    title: 'How do I raise a dispute?',
    question: 'My item arrived damaged or never arrived — what do I do?',
    answer:
      'Open the transaction on [My orders](/my/orders) and tap Raise dispute before you confirm delivery. Disputes can be raised while your payment is still held and the seller has confirmed dispatch. Pick a reason — arrived damaged, wrong item, never arrived, or other — and describe what happened. The transaction moves to Disputed, your payment stays held, and the admin team aims to make first contact within 48 hours.',
    tags: ['disputes', 'buying', 'refunds'],
  },
  {
    sourceKey: 'buy-dispute-outcomes',
    title: 'How is a dispute resolved?',
    question: 'What happens after I raise a dispute?',
    answer:
      "The team gathers evidence from you, the seller and, where relevant, the courier's tracking record, then records one of four outcomes with a written reason: a full refund to you (including shipping); a partial refund where the item is usable but not as described; release to the seller where the dispute is not upheld (you are told why); or escalation to SAPS where fraud is suspected. Your payment stays held throughout, so you are not out of pocket during the review.",
    tags: ['disputes', 'refunds', 'buying'],
  },
  {
    sourceKey: 'buy-refund-timing',
    title: 'How long does a refund take?',
    question: 'When will I get my money back after a refund?',
    answer:
      'Once a refund is approved you are repaid in full, typically within 3–7 business days. On the EFT rail, refunds are paid to your bank account through our daily payment run, so make sure your banking details are saved on your profile — we prompt you if they are missing. Automatic refunds (for example when a seller never dispatches) are triggered by the system without you needing to do anything.',
    tags: ['refunds', 'payments', 'buying'],
  },
  {
    sourceKey: 'buy-not-refundable',
    title: 'What is not refundable?',
    question: 'Are raffle tickets or featured-slot purchases refundable?',
    answer:
      'Three things: competition (raffle) tickets once payment is confirmed — unless Gun Galore cancels the competition, in which case everyone is refunded in full; featured-listing slot wins, except where we remove the listing for an admin-side error; and shipping costs on an order you cancel by choice after the courier has already collected the parcel. Everything else follows the normal [Refund & Dispute Policy](/refund-policy).',
    tags: ['refunds', 'raffles', 'featured'],
  },
  {
    sourceKey: 'buy-experience-cancellation',
    title: 'Can I cancel a hunting package or experience booking?',
    question: 'What happens if I cancel an experience booking?',
    answer:
      'Yes — under section 17 of the Consumer Protection Act you may cancel an advance booking, subject to a reasonable charge that grows as the event date nears: 60+ days out, only a R250 admin fee; 30–59 days, 20% retained; 21–29 days, 40%; 14–20 days, 50%; 7–13 days, 75%; under 7 days or a no-show, 100%. You are refunded in full, with no charge, if the outfitter cancels or fails to deliver, or on death or hospitalisation of the person booked (CPA s17(5)). The exact amounts show before you confirm a cancellation. Full schedule: [Experiences Cancellation Policy](/experiences-cancellation-policy).',
    tags: ['experiences', 'cancellation', 'refunds'],
  },

  // ── Shipping & delivery ────────────────────────────────────────────
  {
    sourceKey: 'ship-courier-options',
    title: 'How are items delivered?',
    question: 'Which couriers does Gun Galore use?',
    answer:
      'Non-firearm gear ships with our courier partners — Pudo locker-to-locker or The Courier Guy door-to-door — with live rate quotes at checkout and tracking on your order page. Sellers can also offer in-person collection. Firearms are never couriered to a buyer: they always route through a SAPS-licensed dealer instead.',
    tags: ['shipping', 'pudo', 'courier guy'],
  },
  {
    sourceKey: 'ship-handling-fee',
    title: 'What is the R15 shipping handling fee?',
    question: 'Why is there a R15 handling fee on my order?',
    answer:
      'R15 is a flat handling fee charged once per courier parcel (waybill) that Gun Galore books — it covers arranging the courier, the label, tracking and delivery support. Multiple items consolidated into one parcel are charged the R15 once. It never applies where no parcel is booked: firearm dealer transfers and in-person collection carry no handling fee.',
    tags: ['shipping', 'fees', 'handling'],
  },
  {
    sourceKey: 'ship-dispatch-window',
    title: 'How long does the seller have to dispatch?',
    question: 'How quickly must a seller ship my order?',
    answer:
      'Sellers must dispatch a courier order within 5 days of accepting it. A reminder goes to the seller roughly 24 hours before the deadline. If the window lapses with no dispatch, the system automatically refunds you in full — you do not need to do anything, and the refund records in your transaction history.',
    tags: ['shipping', 'dispatch', 'sla'],
  },
  {
    sourceKey: 'ship-auto-refund',
    title: 'What if the seller never ships?',
    question: 'What happens if my order is never dispatched?',
    answer:
      'For courier orders (Pudo / The Courier Guy), if the seller has not dispatched within 5 days of accepting, the system automatically refunds you in full and notifies both parties. The seller receives a strike, and repeat offenders are reviewed for suspension. Firearm dealer-transfer and collection orders are not auto-refunded — their logistics run differently, so our team monitors and chases those; contact [support](/support) if yours looks stuck.',
    tags: ['shipping', 'refunds', 'dispatch'],
  },
  {
    sourceKey: 'ship-collection',
    title: 'Can I collect my purchase in person?',
    question: 'Does Gun Galore support collection instead of courier?',
    answer:
      'Yes, where the seller offers it. A collection order has no courier cost and no R15 handling fee, and your payment is still held by Gun Galore. Once you have collected and inspected the item, confirm on the order page to release the payment to the seller. If a collection stalls, we nudge you to confirm and our team steps in on orders that stay unresolved.',
    tags: ['shipping', 'collection', 'delivery'],
  },
  {
    sourceKey: 'ship-tracking-waybill',
    title: 'How does shipping get booked and tracked?',
    question: 'Who books the courier and how do I track my parcel?',
    answer:
      'Gun Galore books the courier automatically the moment the seller accepts your order — the seller receives the waybill, label and drop-off PIN by SMS and email. From there, live tracking events appear on the order page for both sides, from collection through to delivery. Once your parcel lands, inspect it and confirm delivery to complete the order.',
    tags: ['shipping', 'tracking', 'waybill'],
  },

  // ── Firearms & compliance ──────────────────────────────────────────
  {
    sourceKey: 'firearm-dealer-transfer-steps',
    title: 'How does a firearm dealer transfer work?',
    question: 'What are the steps when I buy a firearm on Gun Galore?',
    answer:
      'Six steps: 1) at checkout you choose a SAPS-licensed dealer from our vetted directory; 2) the seller dispatches the firearm to that dealer by approved, insured courier; 3) the dealer receives, verifies and holds it; 4) you present your Competency Certificate, Possession Licence (or proof of a pending application) and ID at the dealer; 5) the dealer completes the SAPS transfer paperwork; 6) you confirm delivery on Gun Galore, which releases the seller payout. Your payment is held the whole time. Full detail: [Firearms Compliance](/firearms-compliance). Confirm specifics with your DFO or a firearms attorney.',
    tags: ['firearms', 'dealer transfer', 'compliance'],
  },
  {
    sourceKey: 'firearm-eligibility',
    title: 'Who may buy or sell a firearm on Gun Galore?',
    question: 'What are the requirements to trade firearms on the platform?',
    answer:
      'You must be 18 or older, a permanent resident of or lawfully present in South Africa, and hold a valid SAPS Competency Certificate for the relevant category. As a buyer you must either hold the relevant Possession Licence or have a pending application on file, and you may not be under a court order, interdict or licence revocation prohibiting possession. Sellers also complete identity verification (KYC) before payouts are released. Confirm specifics with your DFO or a firearms attorney.',
    tags: ['firearms', 'eligibility', 'competency'],
  },
  {
    sourceKey: 'firearm-no-courier-to-door',
    title: 'Can a firearm be couriered to my door?',
    question: 'Will my firearm be delivered to my home?',
    answer:
      'No. By law a firearm cannot be couriered to a home address. Every firearm transfer on Gun Galore completes through a SAPS-licensed dealer: the seller sends the firearm to the dealer you chose at checkout, and you collect it there once the transfer paperwork is done. Attempting to transfer a firearm outside the dealer route breaches the Firearms Control Act and leads to a permanent ban and a report to SAPS. Confirm specifics with your DFO or a firearms attorney.',
    tags: ['firearms', 'delivery', 'dealer transfer'],
  },
  {
    sourceKey: 'firearm-ammo-p2p-ban',
    title: 'Can I sell ammunition to another member?',
    question: 'Is peer-to-peer ammo selling allowed?',
    answer:
      'No. Loose live ammunition may not be sold peer-to-peer between private individuals on Gun Galore — such listings are removed. Live-ammunition sales are restricted to SAPS-licensed dealer sellers where supported. Confirm specifics with your DFO or a firearms attorney.',
    tags: ['firearms', 'ammunition', 'compliance'],
  },
  {
    sourceKey: 'firearm-private-arrangement',
    title: 'What is the Private Arrangement option?',
    question: 'Can the buyer and seller meet at a dealer instead of couriering the firearm?',
    answer:
      'Yes, by mutual agreement at checkout. Under Private Arrangement both parties travel to a SAPS-licensed dealer of their joint choice and complete the transfer in person — intended for cases where both live in the same town and the round-trip courier cost would outweigh the sale value. Note the trade-off: payment captures and releases immediately, so the funds-held protection does not apply (you expressly waive it at checkout via a typed confirmation), and both parties are given each other’s contact details at payment to coordinate the dealer visit. The transfer must still complete through the dealer — it is not a route for off-platform deals. Confirm specifics with your DFO or a firearms attorney.',
    tags: ['firearms', 'private arrangement', 'dealer transfer'],
  },
  {
    sourceKey: 'firearm-saps534-paperwork',
    title: 'What is the SAPS 534 and who completes it?',
    question: 'What paperwork do I complete when my firearm sells?',
    answer:
      "The SAPS 534 'Transfer of Firearm Ownership' form records the change of ownership. When your firearm sells via dealer transfer, Gun Galore emails you the form pre-filled with the details we already hold (your particulars and the firearm details). After the dealer transfer, you upload photos of the completed, dealer-stamped SAPS 534 (block letters only), the dealer's stock-register entry and the serial number; once verified, your payout is released. Confirm specifics with your DFO or a firearms attorney.",
    tags: ['firearms', 'saps 534', 'paperwork', 'selling'],
  },
  {
    sourceKey: 'firearm-licence-expiry',
    title: 'Why was my firearm listing delisted?',
    question: 'What happens when my firearm licence is close to expiry?',
    answer:
      'A firearm cannot be listed on a licence that is within 30 days of expiry. If your licence expires in 31–90 days you get a warning when you list and again as expiry approaches; once the licence comes within 30 days of expiry the listing is automatically delisted. Renew the licence, then relist. Confirm specifics with your DFO or a firearms attorney.',
    tags: ['firearms', 'licence', 'listings'],
  },
  {
    sourceKey: 'firearm-what-counts',
    title: 'What counts as a firearm needing dealer transfer?',
    question: 'Do barrels or receivers need a dealer transfer too?',
    answer:
      'Yes. Dealer transfer applies to any FCA-regulated handgun, rifle or shotgun, firearm barrels (even when sold separately), serial-numbered receivers or frames, and anything else the FCA requires a Possession Licence to acquire. Restricted suppressors are not normally listable. Scopes, optics, slings, holsters, magazines within legal capacity, safes and range gear are not firearms for this policy and ship by normal courier. Confirm specifics with your DFO or a firearms attorney.',
    tags: ['firearms', 'barrels', 'compliance'],
  },

  // ── KYC & payouts ──────────────────────────────────────────────────
  {
    sourceKey: 'kyc-why-required',
    title: 'Why do sellers verify their identity?',
    question: 'Why does Gun Galore require KYC?',
    answer:
      'Identity verification keeps the marketplace trustworthy: buyers know a verified person stands behind every payout, fraud risk drops, and for firearm sales it lets us complete the legally required transfer paperwork. Sellers must be verified before any payout is released. Buyers do not need KYC for ordinary purchases — firearm buyers are identified through the regulated dealer-transfer process instead.',
    tags: ['kyc', 'verification', 'selling'],
  },
  {
    sourceKey: 'kyc-how-it-works',
    title: 'How does identity verification work?',
    question: 'What happens during KYC verification?',
    answer:
      'Three quick steps at [verify your identity](/kyc/verify): 1) give consent; 2) enter your SA ID number, which is checked against Home Affairs records; 3) take a selfie, which is matched to your official ID photo. The check is performed by VerifyNow. Your ID number is stored encrypted, and your selfie is not stored after the match.',
    tags: ['kyc', 'verifynow', 'home affairs'],
  },
  {
    sourceKey: 'kyc-payout-gates',
    title: "Why can't I receive my payout yet?",
    question: 'What do I need before Gun Galore pays me out?',
    answer:
      'Two gates: your seller profile must be complete (SA ID and banking details captured) and your identity must be verified (KYC). Verification is prompted automatically at your first sale, and your money waits safely — held, not lost — until both are done. Track what is outstanding and what you are owed on [My earnings](/my/earnings).',
    tags: ['kyc', 'payouts', 'selling'],
  },
  {
    sourceKey: 'kyc-bank-details',
    title: 'Whose bank account can payouts go to?',
    question: "Can Gun Galore pay my money into someone else's account?",
    answer:
      'No. Payouts go only to a bank account in your own name — we do not pay out to third parties. Before your first payout, our team reviews that the account-holder name matches your verified identity. You can update your banking details on your profile at any time; a change may trigger that review again. This protects your money if your account is ever compromised.',
    tags: ['payouts', 'banking', 'kyc'],
  },
  {
    sourceKey: 'kyc-payout-timing',
    title: 'When are payouts paid?',
    question: 'How long after my sale do I get paid?',
    answer:
      'Once the buyer confirms delivery (or, for a firearm, the dealer transfer is verified), your payout is queued and paid by EFT through our daily payment run on business days. Every sale, fee and payout is itemised on [My earnings](/my/earnings). First-time sellers: complete your profile and identity verification first, or the payout waits until you do.',
    tags: ['payouts', 'selling', 'eft'],
  },

  // ── Competitions & raffles ─────────────────────────────────────────
  {
    sourceKey: 'raffle-free-postal-entry',
    title: 'Can I enter a competition for free?',
    question: 'Is there a free way to enter Gun Galore raffles?',
    answer:
      'Yes — every paid competition accepts free entries by post, as required by section 36 of the Consumer Protection Act. Download the free-entry form (a PDF) from the competition page; it contains the postal address, the deadline (the same as the paid-entry deadline) and a reference code. There is no limit on the number of free entries per person, and free entries carry equal weight to paid entries in the draw.',
    tags: ['raffles', 'competitions', 'free entry', 'cpa'],
  },
  {
    sourceKey: 'raffle-draw-fairness',
    title: 'How do I know the draw is fair?',
    question: 'How are competition winners picked?',
    answer:
      'Draws are verifiably random. Before the draw, the SHA-256 hash of a secret 256-bit random seed is published on the competition draw-proof page. Winners are derived from that seed with cryptographically secure maths, and after the draw the raw seed itself is published — anyone can recompute the hash to confirm it matches and replay the derivation to verify the winning ticket. A 24-hour cooling window also runs between sell-out and the draw so postal entries still in transit can be captured.',
    tags: ['raffles', 'draw', 'fairness'],
  },
  {
    sourceKey: 'raffle-winner-claim',
    title: 'How do winners claim their prize?',
    question: 'What happens if I win a competition?',
    answer:
      'You are notified immediately by email and SMS to the contact details on your account, and you have 7 days to claim. Each draw also selects up to two backup winners using the same verifiable method: if the primary winner does not claim in time, the first backup is promoted, then the second. Keep your contact details current — after all three positions lapse, the prize goes unclaimed.',
    tags: ['raffles', 'winners', 'claim'],
  },
  {
    sourceKey: 'raffle-ticket-refunds',
    title: 'Are raffle tickets refundable?',
    question: 'Can I get a refund on a competition ticket?',
    answer:
      'Once your payment is confirmed, tickets are non-refundable — with one exception: if Gun Galore cancels the competition before the draw runs, every paid ticket holder is refunded in full via the original payment route. The full provisions are in the AML & Competitions Policy in our [legal hub](/legal).',
    tags: ['raffles', 'refunds', 'tickets'],
  },

  // ── GG+ subscription & Ask GG ──────────────────────────────────────
  {
    sourceKey: 'ggplus-tiers',
    title: 'What is GG+ and what does it include?',
    question: 'What do the GG+ Member and Pro subscriptions offer?',
    answer:
      'GG+ Member (R49/month): Ask GG at 20 messages per hour, unlimited photo identification (5 photos per query), the ballistic calculator, a GG+ username badge, 25% off featured-listing bids and a weekly Member raffle entry. GG+ Pro (R149/month): Ask GG at 60 messages per hour, photo identification with 10 photos per query, ballistic calculator plus Load Lab, a verified-expert badge, 50% off featured-listing bids and a weekly Pro raffle entry. Compare and subscribe at [GG+](/subscribe).',
    tags: ['gg+', 'subscription', 'ask gg'],
  },
  {
    sourceKey: 'ggplus-billing',
    title: 'How does GG+ billing work?',
    question: 'Is GG+ a debit order? Does it auto-renew?',
    answer:
      'No debit orders and no auto-renew — GG+ is prepaid. Pick a tier, EFT the amount with your unique reference within the 24-hour pay-by window, and the tier activates as soon as the payment reconciles. Each payment buys 31 days; renewing the same tier before expiry stacks the extra days on top, so paid days are never lost. You can switch tiers once your current period ends, and if you do not renew you simply drop back to the free tier — no cancellation needed.',
    tags: ['gg+', 'billing', 'subscription'],
  },
  {
    sourceKey: 'ggplus-askgg-limits',
    title: 'What are the Ask GG usage limits?',
    question: 'How many Ask GG questions can I ask?',
    answer:
      'Free accounts get 5 Ask GG messages per rolling 30-day window, plus 5 photo identifications per 30 days. GG+ Member raises that to 20 messages per hour and GG+ Pro to 60 per hour, both with unlimited photo identification (Member 5 photos per query, Pro 10). The composer shows how many free messages you have left. Upgrade any time at [GG+](/subscribe).',
    tags: ['ask gg', 'limits', 'gg+'],
  },

  // ── Account & support ──────────────────────────────────────────────
  {
    sourceKey: 'account-get-help',
    title: 'How do I contact Gun Galore support?',
    question: 'Where do I get help with an order or my account?',
    answer:
      'Open a ticket at [Support](/support) — pick a category (general, payment, shipping/delivery, account, a listing, or other), describe the problem, and reply in the same thread when the team answers. You can also email support@gungalore.co.za; include your order reference so we find it fast. For a problem with a paid order, the Raise dispute button on the order page is the best route — it also keeps your payment held while we review.',
    tags: ['support', 'tickets', 'help'],
  },
  {
    sourceKey: 'account-username-privacy',
    title: 'Is my real name shown to other users?',
    question: 'What do other members see about me?',
    answer:
      'Only your chosen username — never your real name or contact details. Usernames keep all communication and deal-making on the platform, which is what makes payment protection and dispute review possible, so never share your phone number or address in listings or messages. Personal information is handled in line with POPIA; see the [Privacy Policy](/privacy) for what we collect, why, and how long we keep it.',
    tags: ['account', 'privacy', 'username', 'popia'],
  },
  {
    sourceKey: 'account-rules',
    title: 'What are the basic account rules?',
    question: 'Can I have more than one Gun Galore account?',
    answer:
      'No — one account per person. You must be 18 or older, keep your credentials confidential (never share access), and notify us immediately at support@gungalore.co.za of any unauthorised use. You are responsible for all activity on your account, including listings, bids, offers and payments. You can close your account at any time; the [Terms](/terms) carry the full rules.',
    tags: ['account', 'rules', 'terms'],
  },
];
