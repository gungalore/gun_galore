// Starter-tile prompts for the Ask Boet empty state. Pure data — safe to
// import from Server or Client Components. Each tile is a one-tap
// starter: title, what it's for, and the question it drops into the
// composer (ready to edit or send).

export interface StarterPrompt {
  title: string;
  desc: string;
  prompt: string;
}

export const GENERIC_STARTER_PROMPTS: StarterPrompt[] = [
  { title: 'Find gear', desc: 'Tell me what you need and I’ll search the marketplace for live stock.', prompt: "I'm looking for a rooftop tent under R15,000 — what's available on Gun Galore?" },
  { title: 'Identify it', desc: 'Snap a photo of any gear — a part, reel, fridge or headstamp — and ask what it is.', prompt: "Help me identify this piece of gear — I'll attach a photo." },
  { title: 'Plan a trip', desc: 'Kit lists, seasons and gear for a hunt, camp or overland trip.', prompt: 'What should I pack for a 3-day overland trip to the Kgalagadi in winter?' },
  { title: 'Hunting & shooting', desc: 'Ammo, optics, zeroing, shot placement and ethical-range guidance.', prompt: "What scope and zero distance suit a .308 hunting rifle, and what's the ethical range for kudu?" },
  { title: 'Reloading data', desc: 'Look up published manual loads by cartridge, bullet and powder.', prompt: 'Show me published loads for 6.5 Creedmoor with 140gr bullets.' },
  { title: 'Sell smarter', desc: 'Turn a few photos into a ready-to-post listing description.', prompt: 'Help me write a listing description for some gear I want to sell.' },
];
