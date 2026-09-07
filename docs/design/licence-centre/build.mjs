import { writeFileSync } from 'node:fs';
import {
  CHIPS, I, cards, cardsRow, footer, meter, page, pill, rowFilled, rowInput, rowSuggested,
  section, shelf, strip, yesNo,
} from './kit.mjs';

const shell = (title) =>
  `<div class="shell"><button class="back" type="button" aria-label="Back">${I.back}</button><span class="title">${title}</span></div>`;

// Sample applicant — invented. Nothing here is a real member.
const DOCS = [
  { letter: 'A', name: 'Identity document', img: true },
  { letter: 'B', name: 'Proof of address', img: true },
  { letter: 'C', name: 'Competency certificate', img: true },
  { letter: 'D', name: 'Licence · CZ 75 SP-01', img: true },
  { letter: 'E', name: 'Licence · Tikka T3x', img: true },
  { letter: 'F', name: 'SAPSA membership card', img: true, check: true },
  { letter: 'G', name: 'Safe photograph', img: true },
  { letter: 'H', name: 'Dealer invoice' },
];

// ── Section bodies, shared by the phone sheet and the desktop sheet ──
const FIREARM = () =>
  section(
    'firearm',
    'Firearm',
    'Read off the dealer invoice you added. Change anything that is wrong.',
    rowFilled({ label: 'Type of firearm', value: 'Handgun', from: 'your dealer invoice' }) +
      rowSuggested({ label: 'Action', value: 'Semi-automatic', from: 'Worked out from the model' }) +
      rowFilled({ label: 'Make', value: 'CZ', from: 'your dealer invoice' }) +
      rowFilled({ label: 'Model', value: 'Shadow 2', from: 'your dealer invoice' }) +
      rowFilled({ label: 'Calibre', value: '9mm Parabellum', from: 'your dealer invoice' }) +
      rowFilled({ label: 'Serial number', value: 'D5A1234', from: 'your dealer invoice' }) +
      rowFilled({ label: 'Where it is coming from', value: 'From a dealer', from: 'you' , tone: 'none' }) +
      `<div class="note"><div class="k">Worked out from your licences</div><div class="t">You already hold a <strong>CZ 75 SP-01 in 9mm Parabellum</strong>. This one will be my</div>${cards(
        [
          { text: 'match pistol for Production Optics, with the SP-01 as my practice and backup pistol', on: true },
          { text: 'backup to the SP-01 at matches' },
          { text: 'pistol for a different division from the SP-01' },
        ],
        { ranked: true },
      )}</div>`,
  );

const YOU = ({ firstTime = false } = {}) =>
  section(
    'you',
    'You',
    'From your ID, proof of address and profile.',
    rowFilled({ label: 'Full name, as it appears on your ID', value: 'Johan Andries Pretorius', from: 'your identity document' }) +
      rowFilled({ label: 'SA ID number', value: '850101 5012 089', from: 'your identity document' }) +
      rowFilled({ label: 'Residential address', value: '14 Kiepersol Street, Bendor, Polokwane, 0699', from: 'your proof of address' }) +
      rowFilled({ label: 'Occupation', value: 'Quantity surveyor', from: 'your profile', profile: true }) +
      rowFilled({ label: 'Employer', value: 'Limpopo Roads Agency, 26 Market Street, Polokwane', from: 'your profile', profile: true }) +
      rowFilled({ label: 'Cellphone', value: '082 555 0134', from: 'your account', tone: 'none' }) +
      rowFilled({ label: 'Postal address', value: 'Same as residential', from: 'your profile', profile: true, tone: 'none' }) +
      (firstTime
        ? rowInput({ label: 'What kind of home is it', kind: 'select', placeholder: 'House, townhouse, flat, farm', profile: true })
        : rowFilled({ label: 'What kind of home is it', value: 'House in a suburb', from: 'your profile', profile: true, tone: 'none' })) +
      rowInput({ label: 'Marital status', kind: 'select', placeholder: 'Single, married, life partner', profile: true }),
  );

const COMPETENCY = () =>
  section(
    'competency',
    'Competency',
    'From your competency certificate.',
    `<div class="line"><span class="ic">${I.checkG}</span><span><div class="t">Handgun · Semi-automatic rifle · Shotgun</div><div class="s">Certificate 1234567 · issued 12 Mar 2024 · valid to 11 Mar 2029</div></span><button type="button" style="min-height:44px;padding:0 8px;font-size:13px;font-weight:500;color:var(--red)">Change</button></div>` +
      `<div class="line"><span class="ic">${I.checkG}</span><span><div class="t">Covers a handgun, the type you are applying for</div><div class="s">from your competency certificate</div></span><span></span></div>`,
  );

const OWN = () =>
  section(
    'own',
    'Firearms you own',
    'From the licences in your Document Centre. Say what each one is for, once.',
    `<div class="row filled"><div><div class="lab">Licence D</div><div class="val">CZ 75 SP-01 · 9mm Parabellum</div><div class="src"><span>Section 16 · licence 20/1234/2024 · expires 14 Jun 2029 · from your licence card</span></div></div><div class="act"><button type="button">Change</button></div></div>` +
      rowFilled({ label: 'What the SP-01 is for', value: 'IPSC Production matches and practice', from: 'your profile', profile: true, tone: 'none' }) +
      `<div class="row filled"><div><div class="lab">Licence E</div><div class="val">Tikka T3x · .308 Winchester</div><div class="src"><span>Section 16 · licence 20/5678/2025 · expires 02 Feb 2030 · from your licence card</span></div></div><div class="act"><button type="button">Change</button></div></div>` +
      cardsRow({
        label: 'What the Tikka is for',
        profile: true,
        items: [
          { text: 'Plains game out to 300 m' },
          { text: 'Bushveld hunting at shorter ranges' },
          { text: 'Long-range practice and club shoots' },
        ],
        ranked: true,
      }),
  );

const PREMISES = () =>
  section(
    'premises',
    'Premises and storage',
    'Saved to your profile. Asked once.',
    rowFilled({ label: 'Perimeter', value: 'Wall with electric fence', from: 'your profile', profile: true, tone: 'none' }) +
      rowFilled({ label: 'Access control', value: 'Remote-controlled gate', from: 'your profile', profile: true, tone: 'none' }) +
      rowFilled({ label: 'Alarm and armed response', value: 'Monitored alarm, armed response', from: 'your profile', profile: true, tone: 'none' }) +
      rowFilled({ label: 'Burglar bars and security gates', value: 'Both', from: 'your profile', profile: true, tone: 'none' }) +
      rowSuggested({ label: 'Safe', value: 'Handgun safe, bolted to the wall', from: 'Read from your safe photograph', profile: true }) +
      rowFilled({ label: 'Who holds the key', value: 'Only me', from: 'your profile', profile: true, tone: 'none' }),
  );

const CASE_SPORT = () =>
  section(
    'case',
    'Your case',
    'Tap what is true. Only tapped cards reach your motivation.',
    rowFilled({ label: 'Association', value: 'SAPSA · member 12345 · dedicated status DS-0987 since 2021', from: 'your membership card', tone: 'check' }) +
      cardsRow({
        label: 'Disciplines you compete in',
        answered: true,
        two: true,
        items: [
          { text: 'IPSC Production Optics', on: true },
          { text: 'IPSC Production' },
          { text: 'IDPA' },
          { text: 'Steel Challenge' },
          { text: 'Service pistol' },
          { text: 'PPC' },
        ],
      }) +
      cardsRow({
        label: 'Why this pistol',
        answered: true,
        items: [
          { text: 'I compete with my own equipment instead of borrowing a club pistol.', on: true },
          { text: 'I shoot club matches most months and provincial matches when they come up.', on: true },
          { text: 'Production Optics needs an optics-ready pistol, and my SP-01 is not one.', on: true },
          { text: 'I keep my dedicated status by logging matches and range days with my association.' },
          { text: 'I shoot postal exercises between matches.' },
        ],
        own: 'I compete with my own equipment instead of borrowing a club pistol. I shoot club matches most months and provincial matches when they come up. Production Optics needs an optics-ready pistol, and my SP-01 is not one.',
      }) +
      cardsRow({
        label: 'Matches you shoot',
        answered: true,
        two: true,
        required: false,
        items: [
          { text: 'Club monthly', on: true },
          { text: 'Provincial', on: true },
          { text: 'National' },
          { text: 'Postal' },
        ],
      }),
  );

const lostDetail = `<div class="detail"><div><div class="lab" style="font-size:12.5px;color:var(--text-secondary)">Tell us what happened</div><div class="inp ta" style="margin-top:5px">A Glock 19 was taken in a house burglary in March 2019 while I was away. It was in the safe; the safe was forced. I reported it the same day.</div></div><div class="boxes"><div class="inp" style="min-height:40px;font-size:13px">Polokwane SAPS</div><div class="inp" style="min-height:40px;font-size:13px">CAS 412/03/2019</div><div class="inp ph" style="min-height:40px;font-size:13px">Which firearm</div><div class="inp ph" style="min-height:40px;font-size:13px">Outcome</div></div></div>`;

const DECLARATIONS = ({ answered = true } = {}) =>
  section(
    'declarations',
    'Declarations',
    'Six questions only you can answer. They go on the SAPS 271 and, if you say yes, into your motivation.',
    yesNo({ q: 'Have you ever been convicted of an offence, in South Africa or anywhere else?', help: 'Every conviction, however old and however minor, including anything you paid an admission-of-guilt fine for.', chosen: answered ? 'No' : '' }) +
      yesNo({ q: 'Is there any case pending against you at the moment?', help: 'Including a case where you have been charged but not yet tried.', chosen: answered ? 'No' : '' }) +
      yesNo({ q: 'Has a firearm of yours ever been lost or stolen?', chosen: answered ? 'Yes' : '', detail: answered ? lostDetail : '' }) +
      (answered ? yesNo({ q: 'Was a negligence case opened against you over that loss?', chosen: '' }) : '') +
      yesNo({ q: 'Have you ever been declared unfit to possess a firearm?', help: 'By a court, or by the Registrar under section 102 or 103 of the Act.', chosen: answered ? 'No' : '' }) +
      yesNo({ q: 'Has a firearm ever been confiscated from you?', chosen: '' }) +
      rowInput({ label: 'Previous applications refused, or licences cancelled', kind: 'long', placeholder: 'Say so plainly if it has happened, with the reason given.', required: false, missing: false }),
  );

const PACK = ({ route = 'dealer' } = {}) =>
  section(
    'pack',
    'Your pack',
    'What SAPS gets, and what we still need before we write.',
    `<div class="row filled"><div class="full"><div class="lab">SAPS 271</div>${meter({
      pct: 92,
      rows: [
        { l: 'D', w: 100, n: '100%' },
        { l: 'E', w: 100, n: '100%' },
        route === 'dealer' ? { l: 'F', w: 8, n: 'dealer', gold: true } : { l: 'F', w: 8, n: 'seller', gold: true },
        { l: 'G', w: 88, n: '88%' },
        { l: 'H', w: 67, n: '67%' },
      ],
    })}<div class="hint" style="margin-top:10px">${route === 'dealer' ? 'Part F is the dealer’s half. We leave it blank for them and say so on the cover note.' : 'Part F is the seller’s half. It is filled from their consent and they sign it with the consent letter.'}</div></div></div>` +
      `<div class="row filled"><div class="full"><div class="lab" style="margin-bottom:6px">Take to SAPS</div><div class="chk"><div class="i"><span class="sq ok"></span><span>Motivation, signed</span><span class="s">we write it</span></div><div class="i"><span class="sq ok"></span><span>SAPS 271, parts D, E, G, H</span><span class="s">pre-filled</span></div><div class="i"><span class="sq ok"></span><span>Certified ID copy</span><span class="s">Annexure A</span></div><div class="i"><span class="sq ok"></span><span>Proof of address</span><span class="s">Annexure B</span></div><div class="i"><span class="sq ok"></span><span>Competency certificate</span><span class="s">Annexure C</span></div><div class="i"><span class="sq ok"></span><span>SAPSA endorsement and good standing</span><span class="s">Annexure F</span></div><div class="i"><span class="sq"></span><span>Two character witness statements</span><span class="s">after writing</span></div></div></div></div>`,
  );

// ═══════════════════════════════════════════════════════════════════
// Main — the sheet, phone 390, S16 sport, populated vault
// ═══════════════════════════════════════════════════════════════════
const mainBody =
  shell('Licence Centre') +
  strip({ ref: 'MO000066', type: 'Dedicated sports shooter', left: 4, chips: CHIPS.map((c) => ({ ...c, dot: ['you', 'own', 'declarations'].includes(c.id) ? 'left' : 'ok' })), active: 'firearm' }) +
  shelf(DOCS) +
  FIREARM() + YOU() + COMPETENCY() + OWN() + PREMISES() + CASE_SPORT() + DECLARATIONS() + PACK() +
  footer({ left: 4 });
writeFileSync('Main.dc.html', page({ title: 'Sheet · phone', body: mainBody, width: 390 }));

// ═══════════════════════════════════════════════════════════════════
// Desktop — 1440: 760 column + preview drawer docked right
// ═══════════════════════════════════════════════════════════════════
const previewSections = (short = false) => `
<div class="pvsec"><h4>Personal details</h4><p>Johan Andries Pretorius, ID 850101 5012 089, a South African citizen residing at 14 Kiepersol Street, Bendor, Polokwane, is employed as a quantity surveyor by Limpopo Roads Agency. He applies for a licence under section 16 of the Firearms Control Act 60 of 2000 for a CZ Shadow 2 semi-automatic pistol in 9mm Parabellum.</p></div>
<div class="pvsec"><h4>Firearm experience</h4><p>The applicant has held a competency certificate for handguns, semi-automatic rifles and shotguns since 12 March 2024 and holds two licensed firearms, set out in the table under Existing firearms.</p></div>
<div class="pvsec"><h4>Competency</h4><p>Competency certificate 1234567, issued 12 March 2024, covers the handgun class applied for. <span style="color:var(--text-faint)">(Annexure C)</span></p></div>
<div class="pvsec"><h4>Security and safe storage</h4><p>The firearm will be kept at the residential address in a handgun safe bolted to the wall, on a property with a wall and electric fence, a remote-controlled gate, a monitored alarm with armed response, burglar bars and security gates. The applicant alone holds the key.</p></div>
<div class="pvsec"><h4>Firearm applied for</h4><p>The CZ Shadow 2 is a steel-framed competition pistol built for the Production and Production Optics divisions. <mark>Production Optics needs an optics-ready pistol, and the applicant's SP-01 is not one.</mark></p></div>
${short ? '' : `
<div class="pvsec"><h4>The calibre</h4><p class="thin">Written from the research layer once you press Write.</p></div>
<div class="pvsec"><h4>Existing firearms</h4><table class="tbl"><tr><td>CZ 75 SP-01</td><td>9mm Parabellum · s16 · to 14 Jun 2029 · IPSC Production matches and practice</td></tr><tr><td>Tikka T3x</td><td>.308 Winchester · s16 · to 02 Feb 2030 · <span style="color:var(--warning)">what it is for: still needed</span></td></tr></table></div>
<div class="pvsec"><h4>Association membership and status</h4><p>The applicant is a member of SAPSA (member 12345) and has held dedicated sports shooter status DS-0987 since 2021. <mark>He competes with his own equipment instead of borrowing a club pistol, and shoots club matches most months and provincial matches when they come up.</mark></p></div>
<div class="pvsec"><h4>Application under section 16</h4><p class="thin">Statutory text quoted from code; the applying paragraphs are written once you press Write.</p></div>
<div class="pvsec"><h4>PAJA</h4><p class="thin">Standard paragraph.</p></div>
<div class="pvsec"><h4>Conclusion</h4><p class="thin">Written once you press Write.</p></div>
<div class="pvsec"><h4>Annexures</h4><table class="tbl"><tr><td>A</td><td>Identity document</td></tr><tr><td>B</td><td>Proof of address</td></tr><tr><td>C</td><td>Competency certificate</td></tr><tr><td>D</td><td>Licence, CZ 75 SP-01</td></tr><tr><td>E</td><td>Licence, Tikka T3x</td></tr><tr><td>F</td><td>SAPSA membership card</td></tr><tr><td>G</td><td>Safe photograph</td></tr><tr><td>H</td><td>Dealer invoice</td></tr></table></div>`}
`;

const desktopBody = `
<div class="nav"><img src="logo-nav-dark.svg" alt="All Outdoor" style="height:30px;width:auto"><div class="links"><span>Shop</span><span>Sell</span><span>Saved</span><span>Alerts</span></div><span class="avatar"></span></div>
<div style="max-width:1280px;margin:0 auto;display:grid;grid-template-columns:760px minmax(0,1fr);gap:40px;padding:0 24px;align-items:start">
  <div style="min-width:0">
    <div class="strip" style="top:0"><div class="row1" style="padding-left:0;padding-right:0"><span class="ref mono">MO000066</span><span class="type">Dedicated sports shooter</span><span class="prog left">4 things left</span></div><div class="row2" style="padding-left:0;padding-right:0"><div class="chips">${CHIPS.map((c, i) => `<a class="chip ${i === 0 ? 'on' : ''}" href="#${c.id}"><span class="dot ${['you', 'own', 'declarations'].includes(c.id) ? '' : 'ok'}"></span>${c.label}</a>`).join('')}</div><button class="pv on" type="button">${I.eye}Preview</button></div></div>
    <div style="margin:0 -16px">${shelf(DOCS)}</div>
    <div style="margin:0 -16px">${FIREARM()}${YOU()}${COMPETENCY()}${OWN()}</div>
    <div style="margin:0 -16px">${footer({ left: 4 })}</div>
  </div>
  <aside style="position:sticky;top:20px;margin-top:20px">
    <div style="border:1px solid var(--border);border-radius:var(--r-md);background:var(--bg-card);box-shadow:var(--elev-1);max-height:1360px;overflow:hidden;display:flex;flex-direction:column">
      <div class="drawer hd" style="border-radius:0;box-shadow:none;border-top:0"><span class="t">What your motivation will say</span><span class="s" style="margin-left:auto">updates as you answer</span></div>
      <div class="body" style="padding:6px 16px 16px;overflow:auto">${previewSections()}</div>
    </div>
  </aside>
</div>`;
writeFileSync('Desktop.dc.html', page({ title: 'Sheet · desktop', body: desktopBody, width: 1440 }));

// ═══════════════════════════════════════════════════════════════════
// List — /licence-centre
// ═══════════════════════════════════════════════════════════════════
const types = [
  ['Self-defence', 'Section 13', 'One firearm — a handgun or a shotgun that is not fully automatic.'],
  ['Occasional hunting or sport-shooting', 'Section 15', 'For someone who hunts or shoots, without dedicated status.'],
  ['Dedicated hunter', 'Section 16', 'Endorsed by an accredited hunting association.'],
  ['Dedicated sports shooter', 'Section 16', 'Endorsed by an accredited sport-shooting association.'],
  ['Renewing an existing licence', 'Section 24', 'The purpose has not changed — you are renewing what you hold.'],
];
const listBody =
  shell('Licence Centre') +
  `<div style="padding:18px 16px 8px"><h1 class="h" style="font-size:24px;margin:0">Licence Centre</h1><p style="margin:4px 0 0;font-size:13px;color:var(--text-tertiary)">We fill in what your documents already say. You tap what is true. We write the motivation and the SAPS 271.</p></div>` +
  section('apps', 'Your applications', '',
    `<div class="appl"><div><div class="n">MO000066 · Dedicated sports shooter</div><div class="s">CZ Shadow 2 · 4 things left · opened 7 Sep 2026</div></div><span class="prog left">4 left</span></div>` +
    `<div class="appl"><div><div class="n">MO000061 · Dedicated hunter</div><div class="s">Sako 85 · written 14 Aug 2026</div></div><span class="prog ready">Pack ready</span></div>`) +
  section('start', 'Start an application', 'Pick the section you are applying under.',
    `<div style="display:flex;flex-direction:column;gap:8px;padding-top:4px">${types.map((t) => `<button type="button" class="tcard"><span class="n">${t[0]}</span><span class="sec">${t[1]}</span><span class="s">${t[2]}</span></button>`).join('')}</div>` +
    `<p class="hint" style="margin-top:12px">Section 13 is one firearm. If you already hold a self-defence licence we will say so before you start.</p>`);
writeFileSync('List.dc.html', page({ title: 'Licence Centre · list', body: listBody, width: 390 }));

// ═══════════════════════════════════════════════════════════════════
// Pack — /licence-centre/[id]/pack
// ═══════════════════════════════════════════════════════════════════
const packBody =
  shell('Your pack') +
  `<div style="padding:14px 16px 0;display:flex;align-items:center;gap:10px"><span class="ref mono" style="font-size:12.5px;color:var(--text-tertiary)">MO000066</span><span class="type" style="font-size:13.5px;font-weight:500">Dedicated sports shooter</span><span class="prog ready" style="margin-left:auto">Written</span></div>` +
  section('motivation', 'Your motivation', '1,420 words · written 8 Sep 2026 · passed our check first time',
    `<div style="border:1px solid var(--border);border-radius:var(--r-md);background:var(--bg-card);padding:16px 16px 4px;margin-top:4px">
      <div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:12px"><div style="width:84px;height:110px;border-radius:6px;background:linear-gradient(160deg,#ECE9E1,#CFC9BC);border:1px solid var(--border);flex-shrink:0"></div><div style="font-size:12.5px;color:var(--text-tertiary)">Cover photo<div style="margin-top:2px;color:var(--text-primary);font-size:13.5px;font-weight:500">From your dealer invoice</div><button type="button" style="margin-top:6px;min-height:44px;font-size:13px;font-weight:500;color:var(--red)">Choose another</button></div></div>
      ${previewSections(true)}
      <button type="button" style="min-height:44px;font-size:13px;font-weight:500;color:var(--red);padding:0">Read the rest</button>
    </div>`) +
  section('form', 'SAPS 271', 'Parts D, E, G and H are filled. Part F is left blank for the dealer.',
    `<div style="display:flex;gap:12px;align-items:center;padding:6px 0"><div style="width:64px;height:84px;border-radius:4px;border:1px solid var(--border);background:repeating-linear-gradient(0deg,#fff 0 6px,#EDEAE1 6px 7px);flex-shrink:0"></div><div style="flex:1;font-size:12.5px;color:var(--text-tertiary)">Sign in black ink, in person, at the DFO. Do not sign at home.</div><button type="button" style="min-height:44px;font-size:13px;font-weight:500;color:var(--red)">Open</button></div>`) +
  section('annex', 'Annexures', '',
    ['A · Identity document', 'B · Proof of address', 'C · Competency certificate', 'D · Licence, CZ 75 SP-01', 'E · Licence, Tikka T3x', 'F · SAPSA membership card', 'G · Safe photograph', 'H · Dealer invoice'].map((a) => `<div class="line"><span class="ic">${I.checkG}</span><span class="t">${a}</span><span></span></div>`).join('')) +
  section('witness', 'Character witnesses', 'Two people who know you. Each gets a link, writes a short statement and signs it on their phone.',
    `<div class="line"><span class="ic">${I.checkG}</span><span><div class="t">Pieter van der Merwe</div><div class="s">signed 8 Sep 2026 · Annexure I</div></span><span></span></div>` +
    `<div class="line"><span class="ic" style="color:var(--gold)">${I.pen}</span><span><div class="t">Thandi Mokoena</div><div class="s">link sent 8 Sep 2026 · waiting</div></span><button type="button" style="min-height:44px;font-size:13px;font-weight:500;color:var(--red)">Resend</button></div>`) +
  section('take', 'Take to SAPS', '',
    `<div class="chk"><div class="i"><span class="sq ok"></span><span>Motivation, signed</span><span class="s">print</span></div><div class="i"><span class="sq ok"></span><span>SAPS 271</span><span class="s">print · sign at the DFO</span></div><div class="i"><span class="sq ok"></span><span>Annexures A to H</span><span class="s">print</span></div><div class="i"><span class="sq"></span><span>Witness statements</span><span class="s">1 of 2</span></div><div class="i"><span class="sq"></span><span>Original ID and competency certificate</span><span class="s">bring the originals</span></div></div>`) +
  `<div class="foot" style="flex-direction:row;gap:8px"><button class="btn line" type="button" style="flex:1">${I.print}Print pack</button><button class="btn line" type="button" style="flex:1">Download PDF</button></div>`;
writeFileSync('Pack.dc.html', page({ title: 'Your pack', body: packBody, width: 390 }));

// ═══════════════════════════════════════════════════════════════════
// EmptyVault — first-timer, same page, more open inputs
// ═══════════════════════════════════════════════════════════════════
const emptyBody =
  shell('Licence Centre') +
  strip({ ref: 'MO000067', type: 'Self-defence', left: 23, chips: CHIPS.map((c) => ({ ...c, dot: 'left' })), active: 'firearm' }) +
  shelf([], { large: true }) +
  section('firearm', 'Firearm', 'Add the dealer invoice or licence card and we fill this in. Or type it.',
    rowInput({ label: 'Type of firearm', kind: 'select', placeholder: 'Handgun, shotgun' }) +
    rowInput({ label: 'Make', placeholder: 'Glock, CZ, Taurus' }) +
    rowInput({ label: 'Model', placeholder: '19, P-10 C, G3' }) +
    rowInput({ label: 'Calibre', placeholder: '9mm Parabellum' }) +
    rowInput({ label: 'Serial number', placeholder: 'As stamped on the frame', required: false, missing: false }) +
    rowInput({ label: 'Where it is coming from', kind: 'select', placeholder: 'From a dealer, from a private owner, inherited' })) +
  section('you', 'You', 'Add your ID and a proof of address and we fill these in.',
    rowInput({ label: 'Full name, as it appears on your ID', placeholder: 'Full names and surname' }) +
    rowInput({ label: 'SA ID number', placeholder: '13 digits' }) +
    rowInput({ label: 'Residential address', kind: 'long', placeholder: 'Street, suburb, town, postal code', hint: 'Where the firearm will be kept.' }) +
    rowInput({ label: 'Occupation', placeholder: 'Teacher, farmer, electrician' }) +
    rowInput({ label: 'Employer', placeholder: 'Leave blank if you are self-employed or not working.', required: false, missing: false }) +
    rowInput({ label: 'Marital status', kind: 'select', placeholder: 'Single, married, life partner', profile: true })) +
  section('competency', 'Competency', 'Add your competency certificate. We read the classes and the dates off it.',
    `<div class="add" style="width:100%"><div class="thumb" style="width:100%;height:auto;padding:14px 16px;flex-direction:row;justify-content:flex-start;gap:12px"><span style="color:var(--red)">${I.plus}</span><span style="font-size:13.5px;color:var(--text-primary);font-weight:500">Add competency certificate</span></div></div>` +
    rowInput({ label: 'Competency certificate number', placeholder: 'On the card', required: true })) +
  `<div style="padding:12px 16px 20px;font-size:12.5px;color:var(--text-tertiary)">Firearms you own, Premises and storage, Your case, Declarations and Your pack continue below in the same shape.</div>` +
  footer({ left: 23 });
writeFileSync('EmptyVault.dc.html', page({ title: 'Sheet · empty vault', body: emptyBody, width: 390 }));

// ═══════════════════════════════════════════════════════════════════
// Preview — the drawer on a phone, over the sheet
// ═══════════════════════════════════════════════════════════════════
const previewBody =
  `<div style="position:relative;height:844px;overflow:hidden">
    <div style="filter:saturate(.9)">${shell('Licence Centre')}${strip({ ref: 'MO000066', type: 'Dedicated sports shooter', left: 4, chips: CHIPS.map((c) => ({ ...c, dot: 'ok' })), active: 'case', previewOn: true })}${shelf(DOCS)}</div>
    <div style="position:absolute;inset:0;background:rgba(26,22,19,.32)"></div>
    <div class="drawer" style="position:absolute;left:0;right:0;bottom:0;height:640px;display:flex;flex-direction:column"><div class="grab"></div><div class="hd"><span class="t">What your motivation will say</span><span class="s" style="margin-left:auto">updates as you answer</span></div><div class="body" style="overflow:auto">${previewSections()}</div></div>
  </div>`;
writeFileSync('Preview.dc.html', page({ title: 'Preview drawer · phone', body: previewBody, width: 390 }));

// ═══════════════════════════════════════════════════════════════════
// PrivateSale — Firearm section with the seller consent card
// ═══════════════════════════════════════════════════════════════════
const privateBody =
  shell('Licence Centre') +
  strip({ ref: 'MO000068', type: 'Dedicated hunter', left: 6, chips: CHIPS.map((c) => ({ ...c, dot: c.id === 'firearm' ? 'ok' : 'left' })), active: 'firearm' }) +
  shelf(DOCS.slice(0, 7)) +
  section('firearm', 'Firearm', 'Read off the seller’s licence card. Change anything that is wrong.',
    rowFilled({ label: 'Type of firearm', value: 'Rifle', from: 'the seller’s licence card' }) +
    rowFilled({ label: 'Action', value: 'Bolt action', from: 'the seller’s licence card' }) +
    rowFilled({ label: 'Make', value: 'Sako', from: 'the seller’s licence card' }) +
    rowFilled({ label: 'Model', value: '85 Hunter', from: 'the seller’s licence card' }) +
    rowFilled({ label: 'Calibre', value: '.30-06 Springfield', from: 'the seller’s licence card' }) +
    rowFilled({ label: 'Serial number', value: 'S85-77120', from: 'the seller’s licence card' }) +
    rowFilled({ label: 'Where it is coming from', value: 'From a private owner', from: 'you', tone: 'none' }) +
    `<div class="note"><div class="k">Seller consent</div><div class="t"><strong>Willem Botha</strong> · licence 20/9012/2021</div><div class="line" style="margin-top:6px"><span class="ic">${I.checkG}</span><span><div class="t">Consent to apply, signed</div><div class="s">7 Sep 2026 · ID and licence copies attached as Annexures I and J</div></span><span></span></div><div class="line"><span class="ic">${I.checkG}</span><span><div class="t">SAPS 271 part F, signed by the seller</div><div class="s">boxes 81 to 87 filled from the consent</div></span><button type="button" style="min-height:44px;font-size:13px;font-weight:500;color:var(--red)">View</button></div></div>` +
    `<div class="note" style="box-shadow:none"><div class="k">Worked out from your licences</div><div class="t">You already hold a <strong>Tikka T3x in .308 Winchester</strong>. This one will be my</div>${cards([
      { text: 'heavier rifle for larger plains game and longer shots' },
      { text: 'second hunting rifle so the T3x can stay set up for shorter ranges' },
      { text: 'rifle for a different class of game from the T3x' },
    ], { ranked: true })}</div>`) +
  `<div style="padding:12px 16px 20px;font-size:12.5px;color:var(--text-tertiary)">The rest of the sheet is the same as the dealer route. Only this card and Part F of the 271 change.</div>` +
  footer({ left: 6 });
writeFileSync('PrivateSale.dc.html', page({ title: 'Sheet · private sale', body: privateBody, width: 390 }));

// ═══════════════════════════════════════════════════════════════════
// Kit — every row state and token, for the build
// ═══════════════════════════════════════════════════════════════════
const spec = (k, demo, wide = false) => `<div class="spec"><div class="k">${k}</div><div class="demo ${wide ? 'wide' : ''}">${demo}</div></div>`;
const sw = (name, val, css) => `<div class="sw"><i style="background:${css ?? val}"></i><b>${name}</b><span>${val}</span></div>`;
const kitBody = `<div class="kit">
<h1>Licence Centre kit</h1>
<p class="sub">Every state of the one row component, the chips, the shelf tile and the buttons. Values are the site’s tokens from globals.css; nothing here is new.</p>

${spec('<b>Tokens</b>Ink and surfaces from <code>globals.css</code>. Card = page = white; the only greys are the inset and the borders.', `<div class="swatches">${sw('--bg / --bg-card', '#FFFFFF')}${sw('--bg-inset', '#F4F2EC')}${sw('--border', '#DDD8CC')}${sw('--border-divider', '#EDEAE1')}${sw('--text-primary', '#1A1613')}${sw('--text-secondary', '#4A443C')}${sw('--text-tertiary', '#7A7267')}${sw('--text-faint', '#9C948A')}${sw('--red', '#C8102E')}${sw('--red-wash', 'rgba(200,16,46,.09)')}${sw('--success', '#1F7A50')}${sw('--gold-strong', '#8F6E0F')}${sw('--gold-wash', 'rgba(168,123,20,.10)')}${sw('--warning', '#8F6E0F')}</div>`, true)}

${spec('<b>Type</b>Archivo 500 for headings (18px section, 24px page, 33px meter). Public Sans for everything else: 14.5/500 value, 13.5 body, 12.5 label, 12 source line, 11 shelf name, 10.5/500 pill. Weights 400 and 500 only.', `<div class="h" style="font-size:18px">Firearms you own</div><div style="font-size:14.5px;font-weight:500;margin-top:6px">CZ 75 SP-01 · 9mm Parabellum</div><div style="font-size:13.5px;margin-top:4px">I compete with my own equipment instead of borrowing a club pistol.</div><div style="font-size:12.5px;color:var(--text-secondary);margin-top:4px">Type of firearm</div><div style="font-size:12px;color:var(--text-tertiary);margin-top:4px">from your dealer invoice</div>`)}

${spec('<b>Row · filled</b><code>state: \'filled\'</code>. Value in full, never masked. Source line says “from …” using the server’s <code>provenance.from</code>. One action, “Change”, 44px tall, red text.', rowFilled({ label: 'SA ID number', value: '850101 5012 089', from: 'your identity document' }))}

${spec('<b>Row · filled, inferred</b>Same state, <code>provenance.inferred</code> true. Adds the gold “check this” pill (provenance.tsx <code>toneFor</code>). Never red.', rowFilled({ label: 'Association', value: 'SAPSA · member 12345 · DS-0987 since 2021', from: 'your membership card', tone: 'check' }))}

${spec('<b>Row · filled, profile-scoped</b><code>scope: \'profile\'</code>. Adds the grey “saved to your profile” pill. Pre-filled on the next application.', rowFilled({ label: 'Who holds the key', value: 'Only me', from: 'your profile', profile: true, tone: 'none' }))}

${spec('<b>Row · suggested</b><code>state: \'suggested\'</code>. Gold wash fading from the left, value shown, two actions: “Confirm” (red) and “Change” (grey). Confirming writes the value with <code>MEMBER</code> provenance.', rowSuggested({ label: 'Action', value: 'Semi-automatic', from: 'Worked out from the model' }))}

${spec('<b>Row · needs_you, text</b><code>state: \'needs_you\'</code>. Input rendered open, 44px, placeholder in the shape of the answer. Amber border while required and empty; “Still needed” at the right of the label. Never “You may know it”.', rowInput({ label: 'Make', placeholder: 'Glock, CZ, Taurus' }))}

${spec('<b>Row · needs_you, select / date / long</b>Same row; the control changes with <code>kind</code>. Optional rows say “Optional” and carry no amber.', rowInput({ label: 'Where it is coming from', kind: 'select', placeholder: 'From a dealer, from a private owner, inherited' }) + rowInput({ label: 'Dedicated status held since', kind: 'date', placeholder: 'DD MM YYYY' }) + rowInput({ label: 'Previous applications refused, or licences cancelled', kind: 'long', placeholder: 'Say so plainly if it has happened, with the reason given.', required: false, missing: false }))}

${spec('<b>Row · cards</b><code>kind: \'cards\'</code>. One-column tiles on a phone, two on desktop or for short labels. 44px minimum, 8px radius, checkbox at left; selected = red keyline over the red wash at weight 500. “most likely” marks the top-ranked option only. Optional textarea below, prefilled from the tapped tiles.', cardsRow({ label: 'Why this pistol', answered: true, items: [{ text: 'I compete with my own equipment instead of borrowing a club pistol.', on: true }, { text: 'I shoot postal exercises between matches.' }], ranked: true, own: 'I compete with my own equipment instead of borrowing a club pistol.' }))}

${spec('<b>Row · yes / no</b>yes-no-pills.tsx as it exists: 13.5px question, 12px help, pills 12.5px with 6/15 padding, 44px tall. Nothing pre-selected. Amber keyline while unanswered. A “Yes” opens the detail textarea and the four form boxes in a 2-column grid under the row.', yesNo({ q: 'Has a firearm of yours ever been lost or stolen?', chosen: 'Yes', detail: lostDetail }) + yesNo({ q: 'Has a firearm ever been confiscated from you?', chosen: '' }))}

${spec('<b>Overlap card</b>Appears in Firearm as soon as make and calibre are known. Shadow <code>--elev-1</code> (needs <code>.gg-tile</code>). Ranked options from <code>overlap.suggestedAngle</code>; the confirmed one leads the comparison section.', `<div class="note"><div class="k">Worked out from your licences</div><div class="t">You already hold a <strong>CZ 75 SP-01 in 9mm Parabellum</strong>. This one will be my</div>${cards([{ text: 'match pistol for Production Optics, with the SP-01 as my practice and backup pistol', on: true }, { text: 'backup to the SP-01 at matches' }], { ranked: true })}</div>`)}

${spec('<b>Header strip</b>Sticky under the 54px shell. Row 1: reference (mono 12.5 tertiary), type (13.5/500), progress pill at the right (amber “N things left”, green “Ready to write”). Row 2: section chips, 30px, scrollable, active = red keyline on red wash; a dot per chip, amber while the section has anything needed. “Preview” toggle pinned at the right.', strip({ ref: 'MO000066', type: 'Dedicated sports shooter', left: 4, chips: CHIPS.map((c) => ({ ...c, dot: c.id === 'you' ? 'left' : 'ok' })), active: 'you' }) + `<div style="height:8px"></div>` + strip({ ref: 'MO000066', type: 'Dedicated sports shooter', left: 0, chips: CHIPS.map((c) => ({ ...c, dot: 'ok' })), active: 'pack', previewOn: true }), true)}

${spec('<b>Shelf</b>72 × 92 thumbs, 6px radius, <code>--border</code>, annexure letter bottom-left in a dark tag (mono 10.5), state dot top-right (green read, gold check). Name under it, 11px, two lines. “Add” is a dashed tile; on an empty vault it becomes the wide tile with the QR and the one-line promise.', shelf(DOCS.slice(0, 4)) + shelf([], { large: true }), true)}

${spec('<b>Footer</b>Sticky bottom. The only red button on the surface. Disabled at 50% with the count under it until nothing is needed.', footer({ left: 4 }) + footer({ left: 0 }))}

${spec('<b>Toast</b>After the shelf reads a document: dark plate, <code>--elev-2</code>, one line. The rows it filled change state under it; the toast does not list them.', `<div class="toast"><span class="ok">${I.checkG.replace('var(--success)', '#8FD4AE')}</span>Read your competency certificate · 3 rows filled</div>`)}
</div>`;
writeFileSync('Kit.dc.html', page({ title: 'Kit', body: kitBody, width: 900 }));

// ═══════════════════════════════════════════════════════════════════
// canvas.json
// ═══════════════════════════════════════════════════════════════════
const canvas = {
  pages: [
    { id: 'screens', name: 'Screens' },
    { id: 'kit', name: 'Kit' },
  ],
  artboards: [
    { file: 'List.dc.html', title: '/licence-centre', x: 0, y: 0, w: 390, h: 1180, page: 'screens' },
    { file: 'Main.dc.html', title: '/licence-centre/[id] · populated vault', x: 480, y: 0, w: 390, h: 4560, page: 'screens' },
    { file: 'EmptyVault.dc.html', title: '/licence-centre/[id] · empty vault', x: 960, y: 0, w: 390, h: 1900, page: 'screens' },
    { file: 'PrivateSale.dc.html', title: 'Firearm · private sale', x: 1440, y: 0, w: 390, h: 1500, page: 'screens' },
    { file: 'Preview.dc.html', title: 'Preview drawer', x: 1920, y: 0, w: 390, h: 844, page: 'screens' },
    { file: 'Pack.dc.html', title: '/licence-centre/[id]/pack', x: 2400, y: 0, w: 390, h: 1900, page: 'screens' },
    { file: 'Desktop.dc.html', title: 'Desktop · 760 column + preview', x: 0, y: 6600, w: 1440, h: 1520, page: 'screens' },
    { file: 'Kit.dc.html', title: 'Kit · row states and tokens', x: 0, y: 0, w: 900, h: 2700, page: 'kit' },
  ],
  annotations: [
    { id: 'read-order', x: 0, y: -170, w: 440, page: 'screens', text: 'Read left to right: list, the sheet with a populated vault, the same sheet for a first-timer, the private-sale variant of the Firearm section, the preview drawer, the pack. Desktop below. The Kit page names every row state with the prop that produces it.' },
    { id: 'sample-data', x: 480, y: -110, w: 380, page: 'screens', text: 'All names, numbers and documents are invented sample data. Nothing is a real member.' },
  ],
  launch: { view: 'canvas', page: 'screens' },
};
writeFileSync('canvas.json', JSON.stringify(canvas, null, 2));
console.log('built');
