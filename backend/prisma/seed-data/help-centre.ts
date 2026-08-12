// Seeded Help-Centre entries for the Ask GG knowledge base.
// SINGLE SOURCE OF TRUTH for platform Q&A copy — edit here and rerun
// `npm run seed:help` (idempotent upsert on sourceKey). Authored from the
// live site copy (FAQ, how-selling-works, legal pages, fee calculator).
//
// The support address is interpolated from SUPPORT_EMAIL rather than typed
// out: these strings become HelpCentre ROWS, so a stale address survives in
// the database long after the source is fixed. Re-run the seed after the
// domain cutover to refresh them.

import { SUPPORT_EMAIL } from '../../src/common/brand';

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
    question: 'Are featured-slot purchases refundable?',
    answer:
      'Two things: featured-listing slot wins, except where we remove the listing for an admin-side error; and shipping costs on an order you cancel by choice after the courier has already collected the parcel. Everything else follows the normal [Refund & Dispute Policy](/refund-policy).',
    tags: ['refunds', 'featured'],
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

  // ── GG+ subscription & Ask GG ──────────────────────────────────────
  {
    sourceKey: 'ggplus-tiers',
    title: 'What is GG+ and what does it include?',
    question: 'What do the GG+ Member and Pro subscriptions offer?',
    answer:
      'GG+ Member (R49/month): Ask GG at 20 messages per hour, unlimited photo identification (5 photos per query), the ballistic calculator, a GG+ username badge and 25% off featured-listing bids. GG+ Pro (R149/month): Ask GG at 60 messages per hour, photo identification with 10 photos per query, ballistic calculator plus Load Lab, a GG+ Pro username badge and 50% off featured-listing bids. Compare and subscribe at [GG+](/subscribe).',
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
      `Open a ticket at [Support](/support) — pick a category (general, payment, shipping/delivery, account, a listing, or other), describe the problem, and reply in the same thread when the team answers. You can also email ${SUPPORT_EMAIL}; include your order reference so we find it fast. For a problem with a paid order, the Raise dispute button on the order page is the best route — it also keeps your payment held while we review.`,
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
      `No — one account per person. You must be 18 or older, keep your credentials confidential (never share access), and notify us immediately at ${SUPPORT_EMAIL} of any unauthorised use. You are responsible for all activity on your account, including listings, bids, offers and payments. You can close your account at any time; the [Terms](/terms) carry the full rules.`,
    tags: ['account', 'rules', 'terms'],
  },

  // ── Discovery features (G4 gap-fill) ────────────────────────────────
  {
    sourceKey: 'wanted-how-it-works',
    title: 'How do Wanted ads work?',
    question: "How do I post that I'm looking for something, and what happens?",
    answer:
      "Can't find what you want? Post a Wanted ad describing it — make, model, condition, budget — and sellers who have a match come to you. It's completely free to post: no upfront fees to advertise. A seller responds by linking one of their own active listings; you then buy it through the normal protected checkout, with your payment held until you receive the item. Only usernames are shared, so your deal stays on-platform. Post one at [Wanted](/wanted/new).",
    tags: ['wanted', 'buying', 'demand'],
  },
  {
    sourceKey: 'featured-listings',
    title: 'How do featured listings work?',
    question: 'How do I get my listing featured, and what does it cost?',
    answer:
      'Featured slots put your listing in prime spots (like the homepage) for a set run. You bid for a slot in a tiered auction — the top bid wins the slot for its duration, and there is a minimum bid per slot tier. GG+ members get a discount on featured bids (Pro more than Member). Featured-slot fees are not refundable once the slot has run, so bid what a burst of extra exposure is worth to you. Manage bids at [Featured](/featured/bid).',
    tags: ['featured', 'selling', 'promotion'],
  },
  {
    sourceKey: 'saved-searches',
    title: 'How do saved searches work?',
    question: 'Can I be told when a matching item is listed?',
    answer:
      "Yes. Save any search and Gun Galore watches the marketplace for you — when a new listing matches, you get an alert. It's the fastest way to be first on hard-to-find items without checking back every day. You can turn alerts on or off per saved search. Manage them at [Saved searches](/saved-searches). Still nothing? Post a free Wanted ad and let sellers come to you.",
    tags: ['saved searches', 'alerts', 'buying'],
  },
  {
    sourceKey: 'wishlist',
    title: 'What does the wishlist do?',
    question: 'How do I save an item, and will I be told if the price drops?',
    answer:
      'Tap the heart on any listing to add it to your wishlist — your shortlist for comparing before you commit. Everything you save sits together at [Wishlist](/wishlist). Prices and availability can change and popular items sell, so a wishlist is a reminder to act rather than a price-lock — grab a good deal before it goes. Want a hand deciding between saved items? Just ask me to compare them.',
    tags: ['wishlist', 'saved', 'buying'],
  },
  {
    sourceKey: 'notifications-manage',
    title: 'How do I manage my notifications?',
    question: 'How do I change or stop the emails and SMSes?',
    answer:
      "Your activity feed lives at [Notifications](/notifications) — offers, bids, dispatch and delivery updates, payout news and disputes. Important events also reach you by SMS and email. You can tune which channels you get in [Settings](/settings). Some messages tied to money or safety (like payment and dispute updates) are always sent so you never miss something that needs you.",
    tags: ['notifications', 'settings', 'account'],
  },

  // ── Buyer-side flows (G4 gap-fill) ──────────────────────────────────
  {
    sourceKey: 'auction-bidder-guide',
    title: 'How do I bid, and what happens if I win?',
    question: 'How does bidding work and what must I do when I win an auction?',
    answer:
      "Enter any amount at or above the next minimum — you can bid again any time before the auction ends. Better: set an auto-bid (your maximum) and Gun Galore bids the smallest amount needed to keep you in front, up to your max, so you don't have to watch the clock. A bid in the final moments extends the deadline (no last-second snipes). Your bid is binding. When you win, you pay through normal checkout within the payment window, with your payment held until delivery; firearms complete via a licensed-dealer transfer.",
    tags: ['auction', 'bidding', 'buying'],
  },
  {
    sourceKey: 'cart-multi-buy',
    title: 'Can I buy several items in one order?',
    question: 'How do I buy multiple items at once and combine shipping?',
    answer:
      'Yes — you can add several items from the same seller to your cart and check out in one go. Shipping is consolidated per parcel, so the flat R15 handling fee applies per courier parcel rather than per item. A cart is single-seller: to buy from more than one seller you check out with each separately, and your payment is protected on every order. Your cart is at [Cart](/cart).',
    tags: ['cart', 'buying', 'shipping'],
  },
  {
    sourceKey: 'experiences-booking',
    title: 'How do hunting packages and experiences work?',
    question: 'How do I book a guided hunt or range day?',
    answer:
      "Experiences — guided hunts, range days and the like — are booked on-site services, not shipped items, so there's no courier. You book and pay, and your payment is held until the experience has been honoured, so you're protected if plans change. Experiences can be sold at a fixed price or by auction. Cancellation terms follow the Consumer Protection Act — see the [Experiences cancellation policy](/experiences-cancellation-policy) or ask me before you book.",
    tags: ['experiences', 'hunting', 'booking'],
  },

  // ── Operational rules (G4 gap-fill) ─────────────────────────────────
  {
    sourceKey: 'firearm-dealer-stock-required',
    title: 'Why must I add a dealer when listing a firearm?',
    question: "Why can't I save my firearm listing without dealer details?",
    answer:
      'When you list a firearm or barrel you must say where you plan to dealer-stock it — the dealer name, province and area — and it is required before the listing can go live. This is because every firearm sale completes through a licensed-dealer transfer, so buyers need to know where the item will move through. It also applies to older firearm listings, which are asked to fill it in when next edited. You still add the serial and a licence photo too, all verified.',
    tags: ['firearms', 'selling', 'dealer'],
  },
  {
    sourceKey: 'swap-proof-of-possession',
    title: 'Why am I asked to photograph my item with a code?',
    question: 'What is the swap proof-of-possession step?',
    answer:
      "Before anything ships in a swap, each side photographs their item next to a unique code we give you for that leg. It proves the item genuinely exists and is in hand — an anti-fraud check that protects both traders. Both sides must also fund their leg before either item moves; if only one side funds, that person is fully reimbursed, so no one is left out of pocket. Track each step at [My swaps](/my/swaps).",
    tags: ['swap', 'trade', 'safety'],
  },
  {
    sourceKey: 'payment-window-reference',
    title: 'What if I pay late or use the wrong reference?',
    question: 'I paid by EFT but my order is not confirmed — what now?',
    answer:
      `Always pay using the exact unique reference shown at checkout — that is how your EFT is matched to your order automatically. If you leave it out or use the wrong one, the payment can sit unmatched and your order stays pending until it is reconciled, which can take longer or need a hand. If your reference was wrong or the order looks stuck, contact ${SUPPORT_EMAIL} with your proof of payment and I can help you draft a ticket. Orders have a pay-by window; pay within it so the item is held for you.`,
    tags: ['payments', 'eft', 'reference'],
  },
  {
    sourceKey: 'seller-strikes',
    title: 'What happens if I do not dispatch on time?',
    question: 'What is a seller strike and what does it lead to?',
    answer:
      "Sellers have a 5-day window from accepting a sale to dispatch it. Miss it and the order is auto-refunded to the buyer and you receive a strike. Strikes count against your seller standing and trust score; repeat non-dispatch is reviewed and can lead to selling being restricted or the account suspended. The fix is simple: only accept sales you can ship, add tracking when you dispatch, and keep your KYC and banking current so nothing stalls. Your standing shows on your [Dashboard](/dashboard).",
    tags: ['selling', 'dispatch', 'standing'],
  },
  {
    sourceKey: 'top-seller-criteria',
    title: 'How do I become a Top Seller?',
    question: 'What do I need to do to qualify for Top Seller status?',
    answer:
      'Top Seller is earned, not bought — it reflects a track record of completed sales and strong buyer ratings, with your KYC and profile complete and no recent strikes for late dispatch. Keep delivering on time and keeping buyers happy and you climb toward it. The reward is real: Top Sellers pay less commission (0.5% of the sale off) and it signals trust to buyers. Track your progress on your [Dashboard](/dashboard).',
    tags: ['top seller', 'selling', 'tiers'],
  },
  {
    sourceKey: 'verified-expert-badge',
    title: 'What is the Verified Expert badge?',
    question: 'How do I earn the Verified Expert badge?',
    answer:
      "Verified Expert is a badge shown on your profile for members recognised for genuinely helpful, accurate contributions to the Gun Galore community — knowledge our team has reviewed and verified. Once you've contributed enough verified answers, the badge appears on your public profile and listings, signalling to buyers that you know your gear. It recognises expertise and knowledge-sharing rather than sales volume.",
    tags: ['badge', 'expert', 'community'],
  },
  {
    sourceKey: 'prohibited-items',
    title: 'What can I not list or ship?',
    question: 'Are there items I am not allowed to sell?',
    answer:
      'Every listing is checked before it goes live to keep prohibited items off the platform. You may not list anything illegal to sell in South Africa, counterfeit goods, or items you are not entitled to sell. Some items are dealer-only or restricted (for example suppressors are not normally listable), and firearms and ammunition have their own rules — firearms complete through a licensed dealer and are never couriered to a door, and person-to-person ammunition sales are not allowed. See the [Acceptable Use Policy](/acceptable-use) and [Firearms Compliance](/firearms-compliance), or ask me before you list.',
    tags: ['listing', 'prohibited', 'rules'],
  },
  {
    sourceKey: 'account-deletion-data',
    title: 'How do I delete my account or request my data?',
    question: 'Can I have my data erased, and what is kept?',
    answer:
      `You can close your account at any time and request access to or deletion of your personal information under POPIA — email ${SUPPORT_EMAIL}. Some records must be kept even after closure: transaction and financial records for legal and tax reasons, and — where you have bought or sold a firearm — the encrypted copy of your SA ID is retained for firearm-transfer (SAP 534) compliance rather than being purged. The [Privacy Policy](/privacy) sets out exactly what we hold, why, and for how long.`,
    tags: ['account', 'privacy', 'popia'],
  },
  {
    sourceKey: 'about-ask-gg',
    title: 'What is Ask GG and can I trust its answers?',
    question: 'Is Ask GG giving me official or legal advice?',
    answer:
      "I'm GG, the Gun Galore assistant — I help you use the site, understand fees and rules, track your own orders and offers, and give outdoor and gear guidance. Site and account help is free for signed-in members; in-depth outdoor and reloading advice uses your GG+ advice quota. I aim to be accurate and grounded in how the platform actually works, but I'm a guide, not a lawyer, financial adviser or Designated Firearms Officer — for firearm law, tax or legal decisions, confirm with a dealer (DFO) or professional. If you need a person, I can draft a support ticket for you to send.",
    tags: ['ask gg', 'support', 'help'],
  },
];
