// ────────────────────────────────────────────────────────────────────
// SOUTH AFRICAN SHOOTING AND HUNTING DISCIPLINES.
//
// Feeds the section 16 (dedicated status) motivation: the applicant picks the
// discipline they actually shoot, and we prefill what that discipline's rules
// demand OF THE FIREARM — which is the part of a section 16 motivation that
// carries the argument, and the part an applicant is least able to write from
// memory.
//
// ⚠️ THE PREFILL IS A STARTING POINT, NOT AN ANSWER. It is the applicant's
// motivation and their signature; every prefill lands in an editable box and
// says so. Equipment rules change, divisions are added, and a rule quoted from
// last season's handbook in somebody's licence application is worse than no
// rule at all.
//
// ⚖️ NEUTRAL FACT ONLY. Nothing here argues for a licence or predicts an
// outcome — it states what the discipline's published rules require. The
// argument is the applicant's to make.
//
// Sourced per discipline from the governing bodies (IPSC/SAPSA, CHASA, SADPA,
// SA Bisley Union, SA Hunters, NARFO, ISSF and the clay-target bodies); the
// URLs used are kept on each row so a future edit can re-check rather than
// re-research. GENERATED from that research — see sources[] before editing by
// hand.
// ────────────────────────────────────────────────────────────────────

export interface ShootingDiscipline {
  /** Stored in the applicant's answers. NEVER renumber or rename these. */
  value: string;
  /** What a South African shooter calls it. */
  label: string;
  /** Groups the dropdown. */
  group: string;
  /** The accrediting or governing body in South Africa. */
  body: string;
  kind: 'sport' | 'hunting' | 'both';
  /** Prefilled into `discipline_requirement`, and editable there. */
  requirement: string;
  sources: string[];
}

/** The value stored when the discipline is not on the list. */
export const DISCIPLINE_OTHER = 'other';

/**
 * The disciplines a field with `optionScope` may offer.
 *
 * ⚠️ ONE DEFINITION, USED BY BOTH SIDES. The wizard's dropdown is built from
 * this, and so is the set the answer is validated against on save. They were
 * separate once and did not have to disagree by much: an applicant could pick
 * an option the form offered and have the server drop it on the way in.
 *
 * A dedicated HUNTER sees the hunting-relevant half. A dedicated sport shooter
 * sees everything, because plenty of them also shoot the hunting-based
 * disciplines competitively.
 */
export function disciplinesInScope(
  scope?: 'hunting' | 'all',
): ShootingDiscipline[] {
  return scope === 'hunting'
    ? SHOOTING_DISCIPLINES.filter((d) => d.kind !== 'sport')
    : SHOOTING_DISCIPLINES;
}

export const SHOOTING_DISCIPLINES: ShootingDiscipline[] = [
  {
    "value": "ipsc-practical-pistol-handgun",
    "label": "IPSC Practical Pistol (Handgun)",
    "group": "Practical and action shooting",
    "body": "SAPSA (South African Practical Shooting Association), the IPSC region for South Africa, founded 1976.",
    "kind": "sport",
    "requirement": "Every IPSC handgun division sets a minimum bullet diameter of 9 mm (0.354\") and a minimum cartridge case length of 19 mm (0.748\"), and ammunition is chronographed against a power factor — 125 for Minor in all divisions, and 160 (Open) or 170 (Standard, Classic, Revolver) for Major. The rest of the equipment rules vary sharply by division: Open allows optics, compensators and a magazine up to 170 mm with no round limit; Standard and Classic require the handgun with an empty magazine to fit inside a 225 × 150 × 45 mm box, forbid optics and compensators, and cap capacity (Classic at 8 rounds Major / 10 Minor), with Major in those two divisions requiring a bullet of at least 10 mm (0.40\"). Production and Production Optics may only use handguns on the published IPSC Production Division List, cap barrel length at 127 mm and magazines at 15 rounds, and impose a minimum trigger pull of 2.27 kg (5 lb) for the first shot or 1.36 kg (3 lb) for every shot; Production forbids optics while Production Optics requires one slide-mounted optic. Optics Division is Minor-only with a mandatory slide-mounted optic, magazines limited to 141.25 mm (170 mm in single-stack guns) and no compensators, and Revolver Division has no size or capacity limit but no optics.",
    "sources": [
      "https://www.ipsc.org/handgun-open-division/",
      "https://www.ipsc.org/handgun-standard-division/",
      "https://www.ipsc.org/handgun-production-division/",
      "https://www.ipsc.org/handgun-production-optics-division/"
    ]
  },
  {
    "value": "ipsc-practical-rifle",
    "label": "IPSC Practical Rifle",
    "group": "Practical and action shooting",
    "body": "SAPSA / IPSC",
    "kind": "sport",
    "requirement": "IPSC sets no minimum calibre for rifles; the ammunition requirement is a power factor of at least 150 for Minor and 320 for Major, verified by chronograph. The rifle must be fitted with a stock so it can be fired from the shoulder, may not have more than one barrel, and triggers or trigger shoes extending beyond the width of the trigger guard are prohibited. Division rules then diverge: Semi Auto Open and both Manual Action divisions permit optical sights, compensators and suppressors, and one bipod whose legs may not exceed 90 cm; Semi Auto Standard prohibits optical sights and bipods entirely, limits any muzzle device to 30 × 90 mm and limits a vertical foregrip to 152 mm (6\") from the barrel centreline. Manual Action Bolt requires the breech to be opened and closed by a handle attached directly to the bolt, operated physically by the competitor.",
    "sources": [
      "https://www.ipsc.org/rifle-semi-auto-open-division/",
      "https://www.ipsc.org/rifle-semi-auto-standard-division/",
      "https://www.ipsc.org/rifle-manual-action-bolt-division/",
      "https://www.ipsc.org/wp-content/uploads/2024/07/IPSC-Rifle-Equipment-Check-Manual-2024.pdf"
    ]
  },
  {
    "value": "ipsc-practical-shotgun",
    "label": "IPSC Practical Shotgun",
    "group": "Practical and action shooting",
    "body": "SAPSA / IPSC",
    "kind": "sport",
    "requirement": "All IPSC shotgun divisions require a minimum calibre of 20 gauge and a minimum power factor of 480. Standard Division requires a complete factory shotgun of which at least 500 units were produced and which is available to the general public — prototypes are excluded — and prohibits optical or electronic sights, compensators, ports, suppressors, external weights or recoil-reduction devices (a recoil pad on the rear face of the stock is allowed), and multiple or revolving magazine tubes. Open Division permits prototypes, optics, compensators, ports, suppressors, external recoil devices and multiple magazine tubes, but caps overall gun length at 1 320 mm. Cartridge loops, clips and side-saddles fitted to the gun are permitted in both.",
    "sources": [
      "https://www.ipsc.org/shotgun-standard-division/",
      "https://www.ipsc.org/shotgun-open-division/"
    ]
  },
  {
    "value": "ipsc-pistol-calibre-carbine-pcc",
    "label": "IPSC Pistol Calibre Carbine (PCC)",
    "group": "Practical and action shooting",
    "body": "SAPSA / IPSC",
    "kind": "sport",
    "requirement": "PCC is restricted to a closed list of handgun cartridges — 9×19 mm, 9×21 mm, .357 SIG, .38 Super, .38 Super Comp, .40 S&W and .45 ACP — with a minimum bullet diameter of 9 mm (0.354\") and case length of 19 mm (0.748\"). Ammunition must make a minimum power factor of 125 (the discipline is scored Minor only), must use a bullet of at least 113 grains, and must not exceed 500 m/s (1 640 fps). A maximum of 33 rounds may be loaded (32 in the magazine) and magazine couplers are prohibited. Optics Division requires an optical or electronic sight; Iron Division prohibits them; compensators, sound and flash suppressors are permitted in both.",
    "sources": [
      "https://www.ipsc.org/pcc-optics-division/",
      "https://www.ipsc.org/pcc-iron-division/"
    ]
  },
  {
    "value": "ipsc-mini-rifle",
    "label": "IPSC Mini Rifle",
    "group": "Practical and action shooting",
    "body": "SAPSA / IPSC",
    "kind": "sport",
    "requirement": "Mini Rifle is confined to commercially manufactured .22 Long Rifle rimfire — both a minimum and a maximum calibre. Standard Division requires a complete Mini Rifle or components produced by a factory and available to the general public, expressly excludes prototypes, and prohibits external weights or recoil-control devices other than a recoil pad on the rear face of the stock. Standard Division also prohibits optical and electronic sights and bipods, limits any muzzle device to 30 × 90 mm, limits a vertical foregrip to 152 mm (6\") from the barrel centreline, and caps loading at 31 rounds (30 in the magazine at the start signal). Open Division relaxes the sighting and modification restrictions.",
    "sources": []
  },
  {
    "value": "ipsc-action-air",
    "label": "IPSC Action Air",
    "group": "Practical and action shooting",
    "body": "SAPSA / IPSC",
    "kind": "sport",
    "requirement": "Action Air mirrors the IPSC centrefire division structure using 6 mm airsoft replicas rather than firearms — Handgun (Open, Standard, Classic, Production, Production Optics), Rifle (Semi Auto Open, Semi Auto Standard) and PCC (Optics, Iron) divisions all exist. ⚠️ Because Action Air uses air-propelled replicas rather than licensable firearms, it is generally not the discipline on which a s.16 firearm motivation would rest; it is listed here only for completeness of the IPSC family.",
    "sources": []
  },
  {
    "value": "defensive-pistol-sadpa",
    "label": "Defensive Pistol (SADPA)",
    "group": "Practical and action shooting",
    "body": "SADPA (South African Defensive Pistol Association)",
    "kind": "sport",
    "requirement": "SADPA is built around concealed carry — courses of fire using only a handgun are shot from concealment unless stated otherwise — and its divisions are defined by dimensional limits rather than by open-ended modification. Most handgun divisions require a minimum calibre of 9 mm (.355) and cap barrel length at 155 mm; Compact Pistol caps width at 38 mm, weight at 1 000 g and barrel at 110 mm; Defensive Pistol caps width at 45 mm, weight at 1 250 g and barrel at 155 mm; Revolver caps weight at 1 500 g; Ultra-Compact caps width at 35 mm (pistol), weight at 1 000 g, magazine length at 100 mm and barrel at 90 mm (9 mm Parabellum or larger) or 102 mm (9 mm Short or smaller). Optical, electronic and laser sights are prohibited in every handgun division except Optics and Lasers. Division capacity is 15 rounds (Service Pistol), 10 (Service Pistol Limited, Optics and Lasers, Rimfire), 8 (Compact and Defensive Pistol) and 6 (Revolver, Ultra-Compact), and minimum power factor is 90 (Ultra-Compact), 120 (Service Pistol, Service Pistol Limited, Optics and Lasers, Compact, Revolver) or 170 (Defensive Pistol, which in practice excludes standard 9 mm Luger and .380 ACP).",
    "sources": []
  },
  {
    "value": "multi-platform-defensive-rifle-carbine-and-shotgun-sadpa",
    "label": "Multi-Platform Defensive — rifle, carbine and shotgun (SADPA)",
    "group": "Practical and action shooting",
    "body": "SADPA",
    "kind": "sport",
    "requirement": "In multi-platform matches the shooter's rifle determines the division. Enhanced Service Rifle, Stock Service Rifle and Open Rifle all require a minimum calibre of 5.56 (.223) and permit any action, with Stock Service Rifle prohibiting telescopic, optical, electronic and laser sights while Enhanced Service Rifle and Open Rifle permit them; Manual-Action Large Rifle requires a centrefire cartridge with a rim diameter of 11.35 mm or larger and a bolt, lever, pump or break action, and Manual-Action Small Rifle requires a centrefire cartridge with a rim diameter under 11.35 mm on the same manual actions. Division capacity is 15 rounds for the service-rifle, rimfire and PCC divisions, 10 for Manual-Action Small Rifle and 5 for Manual-Action Large Rifle; the PCC division is restricted to handgun calibres (9 mm, .357 SIG, .40 S&W, 10 mm or .45 ACP), must be fired from a shoulder stock and must make a minimum power factor of 130. Every shotgun division requires a minimum of 20 gauge, with Semi-Auto, Manual Action and Break Action prohibiting optics, lasers, magazines and speed loaders, Modified Shotgun permitting optics and lasers but no loading devices, and Open Shotgun permitting all of them.",
    "sources": []
  },
  {
    "value": "action-pistol-chasa",
    "label": "Action Pistol (CHASA)",
    "group": "Practical and action shooting",
    "body": "CHASA (Confederation of Hunting Associations of South Africa)",
    "kind": "sport",
    "requirement": "CHASA Action Pistol runs Open and Standard classes for handguns of 9 mm or larger, with parallel Sub-9 mm classes for smaller calibres. Standard Class requires a handgun that has no compensator, no optic (scope or red dot) and a barrel no longer than 6\"; Open Class permits a compensator, an optic and any barrel length. Events are shot at 10, 15, 20, 25, 35 and 50 yards depending on the course (Practical, Barricade, Runner, Falling Plate, Tyro Safety), typically 48 rounds.",
    "sources": []
  },
  {
    "value": "steel-challenge",
    "label": "Steel Challenge",
    "group": "Practical and action shooting",
    "body": "Steel Challenge South Africa (SCSA-affiliated); also recognised as a NARFO-affiliated discipline and shot as a stage format within CHASA, SA Hunters and NARFO postal shoots.",
    "kind": "sport",
    "requirement": "Steel Challenge is a fixed-stage speed discipline scored purely on elapsed time against steel plates, so the equipment rules are division rules rather than accuracy rules. SCSA runs centrefire pistol divisions (Open, Limited, Limited Optics, Production, Single Stack, Carry Optics) and rimfire divisions (Rimfire Pistol Open and Rimfire Pistol Irons); rimfire firearms must be .22 Long Rifle only. Production is scored Minor only and is intended for factory or lightly modified handguns; Carry Optics requires a double-action or striker-fired semi-automatic pistol with an optic and prohibits compensators and ports; Rimfire Open permits optics and compensators. A competitor is limited to one firearm per division, though the same firearm may be entered in more than one division in a match. ⚠️ The South African affiliate's own published rulebook was not located; the division definitions above come from the SCSA rulebook that SA clubs shoot to.",
    "sources": [
      "https://irp-cdn.multiscreensite.com/0ee28a8c/files/uploaded/2019_SCSA_Rulebook.pdf",
      "https://narfo.co.za/sport-shooting-rules/"
    ]
  },
  {
    "value": "cowboy-action-shooting-western-shooting",
    "label": "Cowboy Action Shooting (Western Shooting)",
    "group": "Practical and action shooting",
    "body": "WSSA (Western Shooters of South Africa), affiliated to SASS (Single Action Shooting Society) and shooting to SASS rules with minor local deviations.",
    "kind": "sport",
    "requirement": "The firearms must be of types typical of the pre-1899 American West, either originals or replicas: single-action revolvers in which the hammer is manually cocked before each shot, lever- or pump-action rifles chambered in handgun calibres, and side-by-side or single-shot shotguns of roughly 1860–1899 pattern without automatic ejectors, with the Winchester 1897 slide-action and 1887 lever-action being the only repeaters allowed. Side-by-side, single-shot and lever-action shotguns must be centrefire of at least 20 gauge and no larger than 10 gauge; slide-action shotguns must be centrefire of at least 16 gauge and no larger than 12 gauge, and .410 is confined to the Buckaroo category. Ammunition must be all lead — not jacketed, semi-jacketed, plated, gas-checked or copper-washed — with revolver loads under 1 000 fps and rifle loads under 1 400 fps. Rifles in non-handgun calibres such as .30-30 are not SASS-legal for standard matches.",
    "sources": []
  },
  {
    "value": "target-rifle-bisley-fullbore",
    "label": "Target Rifle (Bisley / fullbore)",
    "group": "Precision and target rifle",
    "body": "SABU (South African Bisley Union), the controlling body for Target Rifle, F-Class and .303 shooting in South Africa.",
    "kind": "sport",
    "requirement": "Target Rifle is prone, single-shot, slow-fire shooting at 300 m to 900 m (300–1 000 yards) with a rifle purpose-built for the discipline. Only two calibres are permitted: 7.62 mm (.308 Win) or 5.56 mm (.223 Rem), and bullet weight is capped at a nominal 155 gr for .308 and a nominal 80 gr for .223. Sights are aperture iron sights fully adjustable for elevation and windage — no telescopic sights. There is no maximum rifle weight, but the trigger must have a safe pull weight of 500 g or more, and the rifle (or all its component parts) must be \"readily available in quantity\" rather than one-off.",
    "sources": []
  },
  {
    "value": "f-class-open-f-open",
    "label": "F-Class Open (F-Open)",
    "group": "Precision and target rifle",
    "body": "SABU (rules referred to ICFRA)",
    "kind": "sport",
    "requirement": "F-Open is prone, slow fire, single-loaded, typically at 300 m to 900 m. Calibre is limited to 8 mm and under, and total rifle weight may not exceed 10 kg. The rifle is fired off an adjustable front rest with a rear bag, neither of which counts toward the weight limit, and rail guns or any connection between the front and rear rest are prohibited; the forend may be no more than 3\" wide and the rifle must be shouldered when fired. Telescopic sights may be of any magnification, but muzzle brakes and suppressors are prohibited.",
    "sources": []
  },
  {
    "value": "f-class-target-rifle-f-tr",
    "label": "F-Class Target Rifle (F/TR)",
    "group": "Precision and target rifle",
    "body": "SABU (rules referred to ICFRA)",
    "kind": "sport",
    "requirement": "F/TR is the most tightly constrained F-Class division: the rifle may be chambered only in .223 or .308, in an unmodified case that must properly chamber a SAAMI GO gauge. The rifle must be fired from a bipod — front rests are not used — and total weight including the bipod may not exceed 8.25 kg; a rear bag is allowed and does not count toward that weight, and rail guns or any connection between front and rear support are prohibited. Scope magnification is unrestricted, but muzzle brakes and suppressors are prohibited.",
    "sources": []
  },
  {
    "value": "f-class-sporting-rifle-standard-and-open",
    "label": "F-Class Sporting Rifle (Standard and Open)",
    "group": "Precision and target rifle",
    "body": "SABU",
    "kind": "sport",
    "requirement": "F Sporting Rifle exists so that owners of commercial hunting-type rifles can shoot the F-Class course. Both sub-divisions permit any calibre up to and including 8 mm. Sporting Rifle Standard caps overall weight at 8.25 kg including the bipod and requires a barrel shorter than 65 cm (26\"); Sporting Rifle Open caps weight at 10 kg including the bipod and imposes no barrel-length limit. As with all F-Class, scope magnification is unrestricted while muzzle brakes and suppressors are prohibited.",
    "sources": []
  },
  {
    "value": "303-class-bisley",
    "label": ".303 Class Bisley",
    "group": "Precision and target rifle",
    "body": "SABU (.303 Class Bisley Club)",
    "kind": "sport",
    "requirement": "The .303 Class applies all SABU 7.62 NATO Target Rifle rules with a small set of exceptions specific to the rifle and ammunition. The rifle must be a standard .303 service rifle at some time issued to British Empire or Commonwealth armed services; it may be rebarrelled, but the barrel must conform to the original weight and length and bull barrels are not permitted. It must be chambered for a .303 cartridge, and only .303 174-grain Mk VII Ball ammunition or the handloaded equivalent may be used. The rifle must be fitted with a vernier-adjustable target aperture rear sight of the Parker Hale, A. J. Parker, Central or similar pattern — rifles with battle sights only are not permitted — and all other rules on sights, slings and trigger pull weight follow SABU Target Rifle.",
    "sources": []
  },
  {
    "value": "service-rifle",
    "label": "Service Rifle",
    "group": "Precision and target rifle",
    "body": "SASRA (South African Service Rifle Association), a SASSCo affiliate.",
    "kind": "sport",
    "requirement": "Service Rifle is shot with a service rifle from field positions (standing, sitting, kneeling, squatting, prone) using standard-issue-type ball ammunition; armour-piercing and tracer are prohibited. Bipods, monopods, tripods and bench rests are all prohibited — slings may be used and the rifle may pivot on one point only, the magazine. Magazines may be any magazine for the specific rifle up to 360 mm in length, and drum magazines are prohibited. Classes are defined mainly by sighting: Service Class X is a semi-automatic 5.56 rifle (LM4/5, Galil, AR15) with a scope of 1–4.5×, and a variable scope of higher range must be set to a maximum of 4.5×; Open Class X allows any calibre and any scope; A Class is iron sights; Open Bolt Class X and Open Bolt Class A cover bolt-action rifles (e.g. .303, .308) with and without optics respectively.",
    "sources": []
  },
  {
    "value": "precision-rifle-prs",
    "label": "Precision Rifle (PRS)",
    "group": "Precision and target rifle",
    "body": "SAPRF (South African Practical Precision Rifle Federation), which runs the SA national and provincial PRS series.",
    "kind": "sport",
    "requirement": "All SAPRF divisions cap the rifle at .30 calibre and 3 200 fps muzzle velocity, a limit set to preserve target and barrel life; there is no restriction on optics in any division. Open Division has few other equipment rules. Limited (Tactical) Division is restricted to .308 Winchester only, with a maximum bullet weight of 178 grains and a maximum muzzle energy of 500 kgr/fps (grain × fps ÷ 1000). Factory Division requires a non-custom stock rifle assembled by a single mainstream manufacturer with that manufacturer's action, chassis/stock and trigger, a minimum 1.5 lb trigger pull, no more than 10 rounds in the magazine at the start signal, and a bipod fixed in position for the duration of a stage. Classic Division caps the rifle at 16 lb / 7.25 kg, allows a maximum of 5 rounds in the rifle at any time and only one magazine, and sets a minimum muzzle energy of 380 kgr/fps.",
    "sources": []
  },
  {
    "value": "benchrest-rimfire-and-air-rifle",
    "label": "Benchrest (rimfire and air rifle)",
    "group": "Precision and target rifle",
    "body": "SAPSSF (South African Precision Sport Shooting Federation), a SASSCo affiliate; SABSF (South African Benchrest Shooting Federation) is also listed as a SASSCo affiliate and as a NARFO-recognised body.",
    "kind": "sport",
    "requirement": "Benchrest is fired from a bench off front and rear rests and is scored purely on extreme accuracy, so equipment rules are expressed as weight and dimension classes rather than calibre minimums. SAPSSF states that the codes it shoots are rimfire benchrest and all air rifle benchrest classes, including Extreme Benchrest, with league, provincial and national competition and a national ranking. ⚠️ The class-by-class weight, calibre and rest specifications were not retrievable: SABSF's domain (sabsf.co.za) is currently a parked registrar page and SAPSSF publishes its rules behind a member login. The internationally applied rule set for these codes is the WRABF (World Rimfire & Air Rifle Benchrest Federation) rulebook; do not prefill specific weight classes without checking the current SA rules.",
    "sources": [
      "https://www.sapssf.com/?p=AboutUs",
      "https://www.sassco.co.za/index.php/affiliates/"
    ]
  },
  {
    "value": "gallery-rifle",
    "label": "Gallery Rifle",
    "group": "Precision and target rifle",
    "body": "SAGRF (South African Gallery Rifle Federation), affiliated to the IGRF; promoted through SA Hunters.",
    "kind": "sport",
    "requirement": "Gallery Rifle is short- and medium-range rifle shooting, generally between 10 m and 50 m with a large proportion of events at 25 m, using rifles chambered for traditional handgun calibres. The two main classes are Gallery Rifle Small Bore (.22 Long Rifle, most commonly semi-automatic but pump, lever, bolt and single-shot rifles are permitted in some events) and Gallery Rifle Centre Fire (typically lever-action rifles in .38/.357, .44 and .45, with pistol-calibre AR-pattern carbines increasingly accepted). Classification rules permit iron sights, telescopic sights or red-dot sights depending on the event class. ⚠️ SAGRF's own rules page (sagrf.co.za) returns an empty page and its rules were not retrievable; the description above is the IGRF-family baseline, not a verified SAGRF rulebook. SA Hunters lists SAGRF contacts rather than publishing the rules.",
    "sources": [
      "https://sahunters.co.za/shooting/sagrf/",
      "https://en.wikipedia.org/wiki/Gallery_Rifle_Shooting"
    ]
  },
  {
    "value": "metallic-silhouette-big-bore-rifle",
    "label": "Metallic Silhouette — Big Bore Rifle",
    "group": "Metallic silhouette",
    "body": "SAMSSA / IMSSU - Type: SPORT SHOOTING",
    "kind": "sport",
    "requirement": "All big bore rifle silhouette is fired standing, offhand, with no shooting coats, hooked butt plates, gloves or slings used for support, at chickens 200 m, pigs 300 m, turkeys 385 m and rams 500 m. The Silhouette Rifle event requires a rifle of 6 mm (.243\") or larger, weighing no more than 4.6 kg including sights, with a barrel no longer than 762 mm (30\") measured from the face of the closed bolt, a fore-end no more than 57 mm wide and 57 mm deep from the bore centreline and extending at least 203 mm forward of the receiver ring, and a conventional trigger guard no deeper than 35 mm below the fore-end line; any sights may be used. The Hunting Rifle event requires a common factory hunting rifle of 6 mm (.243\") or larger — custom rifles are prohibited — weighing no more than 4.2 kg including sights, with a factory stock (no thumbhole, no attachments), a scope mounted no more than 38 mm above the receiver and not offset from the bore, a trigger that may be adjusted but not replaced with a custom trigger and with a minimum pull of 0.907 kg (2 lb), and magazines loaded with five cartridges.",
    "sources": []
  },
  {
    "value": "metallic-silhouette-smallbore-rifle",
    "label": "Metallic Silhouette — Smallbore Rifle",
    "group": "Metallic silhouette",
    "body": "SAMSSA / IMSSU - Type: SPORT SHOOTING",
    "kind": "sport",
    "requirement": "Smallbore silhouette is fired standing at chickens 40 m, pigs 60 m, turkeys 77 m and rams 100 m, and the rifle must be chambered only for .22 Short, Long or Long Rifle rimfire. The Silhouette Rifle event uses the same dimensional specification as the Big Bore Silhouette Rifle — maximum 4.6 kg including sights, fore-end no more than 57 mm wide and deep, trigger guard no deeper than 35 mm, barrel no longer than 762 mm — with any sights permitted. The Light Rifle event requires a commercially available sporting rifle, single-shot or repeating, weighing no more than 3.855 kg including sights, and repeaters must be fed from the magazine or clip with five cartridges loaded.",
    "sources": []
  },
  {
    "value": "metallic-silhouette-big-bore-pistol",
    "label": "Metallic Silhouette — Big Bore Pistol",
    "group": "Metallic silhouette",
    "body": "SAMSSA / IMSSU - Type: SPORT SHOOTING",
    "kind": "sport",
    "requirement": "Big Bore Pistol is fired at chickens 50 m, pigs 100 m, turkeys 150 m and rams 200 m, freestyle (body support only) except in the Standing event, and any self-contained centrefire cartridge may be used provided the chambering is available to the general public. A Production handgun may weigh no more than 1.814 kg (4 lb) complete with all sighting equipment and an empty magazine, with a barrel no longer than 273 mm (10.75\"), an overall length no greater than 457 mm (revolvers) or 406 mm (other pistols), and a sight radius no greater than 342 mm; muzzle brakes are prohibited and grips must be conventional — they may not encircle the hand or extend behind the wrist joint. An Unlimited handgun may have a barrel length and sight radius up to 381 mm (15\") and a maximum weight of 2.041 kg (4.5 lb) unloaded with magazine, and must be at least 6 mm (0.243\") calibre because the Unlimited event is shot on half-scale targets. Trigger width, including any trigger shoe, may not exceed the width of the trigger guard.",
    "sources": []
  },
  {
    "value": "metallic-silhouette-smallbore-pistol",
    "label": "Metallic Silhouette — Smallbore Pistol",
    "group": "Metallic silhouette",
    "body": "SAMSSA / IMSSU - Type: SPORT SHOOTING",
    "kind": "sport",
    "requirement": "Smallbore Pistol is fired at chickens 25 m, pigs 50 m, turkeys 75 m and rams 100 m, and ammunition is restricted to any manufactured .22 Short, .22 Long or .22 Long Rifle self-contained rimfire cartridge. The Production, Standing and Unlimited handgun specifications are the same as for Big Bore Pistol: a Production pistol is capped at 1.814 kg (4 lb) with sights and empty magazine, 273 mm barrel, 342 mm sight radius and 457 mm / 406 mm overall length, with no muzzle brakes and conventional grips, while an Unlimited pistol is capped at 2.041 kg (4.5 lb) with a 381 mm barrel and sight radius.",
    "sources": []
  },
  {
    "value": "field-pistol-silhouette",
    "label": "Field Pistol Silhouette",
    "group": "Metallic silhouette",
    "body": "SAMSSA / IMSSU - Type: SPORT SHOOTING",
    "kind": "sport",
    "requirement": "Field Pistol is fired standing at chickens 25, pigs 50, turkeys 75 and rams 100 metres or yards, in two events — Production (no diopters) and Production Any Sights. The cartridge must be a big bore cartridge with a case no longer than the nominal .22 Hornet case length of 35.64 mm (1.403\"); rimfire cartridges are not allowed. The handgun itself must meet the IMSSU Production specification: maximum 1.814 kg (4 lb) with all sighting equipment and empty magazine, barrel no longer than 273 mm, sight radius no greater than 342 mm, overall length no more than 457 mm (revolver) or 406 mm (other), no muzzle brakes, and conventional grips that do not support the firearm on any part of the body other than the hands.",
    "sources": []
  },
  {
    "value": "clay-target-chasa-clay-sport-shooting-25-clays",
    "label": "Clay target — CHASA Clay Sport Shooting (25 clays)",
    "group": "Clay target shooting",
    "body": "CHASA - Type: BOTH (framed as hunter development)",
    "kind": "sport",
    "requirement": "CHASA's own 25-clay event runs only two classes: Classic, limited to side-by-side and over-and-under shotguns, and Modern, for semi-automatic and pump-action shotguns which may load only two shells at each stand. Multi-choke set-ups are permitted but the choke may not be changed while on the stand, standard clays must be used, and a maximum of two shots may be fired at each target.",
    "sources": []
  },
  {
    "value": "hunting-rifle-shooting-222-223-class",
    "label": "Hunting Rifle Shooting — .222/.223 class",
    "group": "Hunting-based shooting",
    "body": "SAHRSA (South African Hunting Rifle Shooting Association), under IHRSA rules; the closely related SASRFSA (South African Small Rifle Field Shooting Association) runs the same calibre concept on full-size animal paper and steel targets.",
    "kind": "both",
    "requirement": "The rules apply to centrefire and .22 Long Rifle rimfire hunting rifles, with a minimum centrefire calibre of .20 (5 mm). A .222/.223 class rifle must be chambered for standard .222 Rem or .223 Rem, weigh no more than 6 kg including any suppressor, have a barrel extending no more than 26\" (660.4 mm) from the front of the action, and carry no muzzle brake; scope turrets are sealed by the organisers before the match so no dialling is possible, and magnification must be set at 14× or lower at all times. Bipods and other steadying attachments are prohibited unless the organisers announce otherwise at least two months in advance; slings may be single or double strap but must attach ahead of the barrel/action joint and behind the action tang; no electronic or mechanical range-finding equipment may be used anywhere on the premises. Semi-automatic and pump-action .223 rifles may be shot but compete in a separate class and do not count for official ranking. Rimfire events use .22 LR only at a maximum of about 150 m on 25–100 mm gongs, while .223 centrefire events run to about 250 m, with offhand stages at no more than 100 m and steel at no less than 50 m.",
    "sources": [
      "https://www.sahuntingrifle.co.za/uploaded/SAHRSA%20223%20Rev%201_1(02-2023",
      "https://www.sasrfsa.co.za/p2/about-us/about-the-south-african-small-rifle-field-shooting-association.html"
    ]
  },
  {
    "value": "baanskiet-chasa-centrefire-rimfire-and-hunting-handgun",
    "label": "Baanskiet (CHASA) — centrefire, rimfire and hunting handgun",
    "group": "Hunting-based shooting",
    "body": "CHASA - Type: BOTH",
    "kind": "sport",
    "requirement": "Baanskiet is CHASA's primary event and is shot on animal-silhouette paper targets and steel gongs from prone, standing tripod and free-standing positions — centrefire at 35 m, 125 m, 200 m and gongs at 150–200 m; rimfire at 20 m, 40 m, 70 m and gongs at 50–75 m; hunting handgun at 20 m, 40 m, 70 m and gongs at 50–75 m. The class structure is defined by sights and optics rather than calibre: for centrefire and rimfire rifles, Standard Class permits any barrel length and thickness but requires the scope to be set no higher than 12× (a higher-magnification scope must be turned down), while Open Class permits any magnification; the Semi Auto class runs Standard = metallic sights only and Open = optics (scope, reflex or red dot). Rimfire classes are restricted to .22 rimfire calibres with straight-walled cases. Hunting Handgun Standard Class requires a straight-walled-case revolver of at least .38 Special with metallic or optical sights, while a handgun in a rifle calibre (a non-straight-walled case, e.g. a Thompson Contender in .223) shoots the rifle course of fire and is registered in Open Class. Scopes with built-in rangefinders or electronic aids may not be used in any event.",
    "sources": []
  },
  {
    "value": "vlakteskiet-chasa",
    "label": "Vlakteskiet (CHASA)",
    "group": "Hunting-based shooting",
    "body": "CHASA - Type: BOTH",
    "kind": "sport",
    "requirement": "Vlakteskiet is a centrefire rifle event of 20 shots over four ranges with all targets distributed between 150 m and 350 m, the actual distances announced only before the event starts, so it is a test of holdover and wind rather than of dialling. Positions are standing off the CHASA standing tripod, sitting off the side of the CHASA sitting tripod with two points of contact, and prone off a carpet-covered 200 × 200 × 400 mm block or a Harris-type removable bipod; the bipod must be removed for the standing and sitting stages. The same CHASA class structure applies — Standard Class capped at 12× magnification, Open Class unrestricted — and rangefinding scopes are prohibited.",
    "sources": []
  },
  {
    "value": "gong-shoot-chasa-centrefire-and-rimfire",
    "label": "Gong Shoot (CHASA) — centrefire and rimfire",
    "group": "Hunting-based shooting",
    "body": "CHASA - Type: BOTH",
    "kind": "sport",
    "requirement": "The CHASA Gong Shoot is a hit/miss steel discipline and is one of the CHASA events that expressly makes provision for semi-automatic firearms. Centrefire ranges use AR500 steel at least 12 mm thick in 100 mm, 150 mm and 200 mm diameters set from roughly 150 m to 200 m; rimfire ranges use mild or Hardox 400 steel at least 5 mm thick in 50 mm, 75 mm and 100 mm squares hung diamond-wise. Armour-piercing, steel-cored and tracer ammunition is prohibited. Rifles are shot off the CHASA sitting and standing tripods and prone off a block or fitted bipod, engaging left to right with one shot per gong.",
    "sources": []
  },
  {
    "value": "bushveld-shoot-chasa",
    "label": "Bushveld Shoot (CHASA)",
    "group": "Hunting-based shooting",
    "body": "CHASA - Type: BOTH",
    "kind": "sport",
    "requirement": "The Bushveld Shoot is designed around normal bushveld hunting conditions on a 200 m range, and its equipment rules deliberately exclude target-rifle hardware. The rifle must be any centrefire of .22 calibre and larger, with a crown of no more than 19 mm and a scope set no higher than 10× magnification. Aluminium chassis stocks are not permitted. Suppressors are permitted, and normal two-point slings fitted on either side of the trigger may be used; bipods are removed for the free-standing and sitting stages. Stages are shot free-standing and sitting at targets such as warthog at 40 m and impala at 100 m against short time limits.",
    "sources": []
  },
  {
    "value": "big-bore-dangerous-game-shoot",
    "label": "Big Bore / Dangerous Game Shoot",
    "group": "Hunting-based shooting",
    "body": "CHASA (Big Bore Shoot); BASA (Bigbore Association of Southern Africa); also run as a NARFO firearm category (BBRBA / BBRBN, \"9,3 mm and larger\").",
    "kind": "both",
    "requirement": "The CHASA Big Bore Shoot is fired on two CHASA Buffalo targets, six shots, two per position, from 50 m (tripod and free-standing), 25 m and 10 m, within a 90-second limit, and no rifle sling may be used. The main class requires a rifle of 9.3×62 or larger; a Sub-bore class exists for men and veterans at .30 calibre or larger and for ladies and juniors at .223 or larger, with no silencers allowed in Sub-bore, and Sub-bore scores are not entered on the CHASA ranking until the adoption threshold is met. BASA accepts big bore calibres from 9.3×62 upwards and sets its ranges so that some limit loading to two rounds (favouring double rifles) while others allow a full magazine, with certain stages starting with a loaded rifle and the safety on. NARFO's own big bore postal categories likewise define big bore as 9.3 mm and larger, in bolt or break action.",
    "sources": [
      "https://www.chasa.co.za/images/pdf/InterassociationShootrules/VER12_Rev2_CHASA_Sportskiet_Sports_Shooting_Consolidation_2024.pdf",
      "https://bigboresa.org/",
      "https://portal.narfo.co.za/uploads/2020/12/NARFO%20Sport%20Shooting%20Rules%20(J"
    ]
  },
  {
    "value": "sa-hunters-hunting-based-shooting-exercises",
    "label": "SA Hunters hunting-based shooting exercises",
    "group": "Hunting-based shooting",
    "body": "SAHGCA / SA Hunters (SA Jagters — SA Hunters & Game Conservation Association)",
    "kind": "both",
    "requirement": "SA Hunters runs a standard set of branch-level hunting-based exercises on realistic animal targets — HG01 Bushveld, HG02 Bushveld Open Sight, HG03 Impala With Rest, HG04 Impala Without Rest, HG05 Jackal, HG06 Big Bore, HG07 Warthog, HG08 Plains/Ridges/Hills, HG09 Plains Black Wildebeest — plus hunting handgun exercises graded by distance (HH01 Bush 10–30 m, HH02 Savannah 30–70 m, HH03 Karoo 70–130 m), HP01 Muzzle Loader, HB01 Hunting Bow, and the HO01/HO02 Dedicated Hunter shoot tests. The firearm constraint that defines each exercise is the pairing of firearm class with support and sighting: the Bushveld Open Sight exercise excludes telescopic sights entirely, the \"With Rest\" and \"Without Rest\" impala exercises differ only in whether artificial support is permitted, and the Big Bore exercise is restricted to big bore hunting calibres. ⚠️ The numeric equipment specification for each exercise is published only in downloadable per-exercise rule PDFs which were not retrievable; do not prefill calibre or magnification figures for these exercises without the current SA Hunters rule sheet.",
    "sources": [
      "https://sahunters.co.za/shooting/hunting-based-shooting/hunting-based-shooting-exercises/",
      "https://sahunters.co.za/shooting/"
    ]
  },
  {
    "value": "multi-discipline-sport-shooting-mds-sa-hunters",
    "label": "Multi-Discipline Sport Shooting (MDS) — SA Hunters",
    "group": "Hunting-based shooting",
    "body": "SAHGCA / SA Hunters - Type: SPORT SHOOTING",
    "kind": "sport",
    "requirement": "MDS is an active, movement-based shooting activity with an explicit emphasis on everyday equipment rather than specialised competition hardware. SA Hunters states it is currently shot with handguns only, with an intention to extend it to semi-automatic shotguns and rifles. ⚠️ The MDS division/equipment table was not retrievable from the public site — leave equipment figures for the applicant to complete.",
    "sources": []
  },
  {
    "value": "wingshooting",
    "label": "Wingshooting",
    "group": "Hunting-based shooting",
    "body": "SAWA / SA Wingshooters Association, described as the only national bird hunting and shooting association in South Africa with SAPS accreditation as both a Hunting and a Sport Shooting association; also SAWSA in the NARFO list.",
    "kind": "both",
    "requirement": "Wingshooting is live game-bird shooting with a shotgun, and the association's associated sport-shooting programme covers rifles, handguns, self-loading rifles, pistol calibre carbines and shotguns through sub-clubs — the LRSC (Long Range Shooting Club, with a 1 200 m facility), the .22 PSBC (.22 Precision Small-Bore Club for .22 LR only), the PSP Postal Shooting Programme for handguns and rifles, and TPS (Tactical Precision Shooting) for 2-gun, 3-gun and 4-gun multi-gun events combining handgun, shotgun, semi-auto rifle/PCC and bolt-action rifle. ⚠️ SAWA's per-programme equipment rules are behind a members' portal and were not retrievable; the shotgun constraint for the wingshooting activity itself is set by provincial hunting proclamations rather than by an association rulebook.",
    "sources": []
  },
  {
    "value": "10-m-air-rifle-olympic-and-sporter",
    "label": "10 m Air Rifle (Olympic and Sporter)",
    "group": "Airgun disciplines",
    "body": "SAARA (South African Air Rifle Association), stated to be the official and only national controlling body for air rifle shooting in South Africa as recognised by SASSCo, SASCOC and SRSA.",
    "kind": "sport",
    "requirement": "SAARA runs South African Championships in 10 m Sporter and 10 m Olympic classes for men and women. ⚠️ NOT VERIFIED IN DETAIL. SAARA's class equipment specifications sit in its members' downloads area and were not retrievable. The ISSF baseline applicable to the Olympic class is a 4.5 mm (.177) calibre air rifle with diopter/aperture sights and no optical sights, fired standing at 10 m; Sporter classes internationally impose a substantially lower maximum rifle weight and forbid adjustable cheekpieces and butt hooks. Do not prefill weight or trigger figures for SAARA classes without the current SAARA specification.",
    "sources": []
  },
  {
    "value": "10-m-air-pistol",
    "label": "10 m Air Pistol",
    "group": "Airgun disciplines",
    "body": "SAPF / SAPA (South African Pistol Federation), which states it practises ISSF, NPA and PPC disciplines.",
    "kind": "sport",
    "requirement": "⚠️ NOT VERIFIED FROM A SOUTH AFRICAN SOURCE. SAPF publishes an events calendar and results but not an equipment rulebook; the discipline runs under ISSF rules. Leave the equipment paragraph for the applicant to complete from the current ISSF technical rules rather than prefilling figures.",
    "sources": []
  },
  {
    "value": "field-target-airgun",
    "label": "Field Target Airgun",
    "group": "Airgun disciplines",
    "body": "SAFTAA (South African Field Target Airgun Association), under WFTF (World Field Target Federation) rules.",
    "kind": "sport",
    "requirement": "Field Target is precision outdoor air rifle shooting at metal silhouette targets placed between 9 m and 50 m at varying angles and elevations, scored one point for a knockdown and zero for a miss. All WFTF competition is subject to a strict muzzle energy limit of 12 ft-lb (16 joules), introduced in 2007. Most competitors use pre-charged pneumatic (PCP) rifles for low recoil and consistency, though spring-powered rifles are also used; rifles are commonly fitted with adjustable stocks, cheek rests, butt hooks and \"hamsters\" (fore-end platforms used for stability in kneeling and sitting positions). High-magnification telescopic sights with side-wheel parallax adjustment are standard, because the shooter ranges the target by focusing the scope and reading the mark on the focus control.",
    "sources": []
  },
  {
    "value": "muzzle-loading-rifle",
    "label": "Muzzle-Loading Rifle",
    "group": "Historical and black powder shooting",
    "body": "BPSU (Black Powder Shooting Union of South Africa), affiliated to MLAIC (Muzzle Loaders Associations' International Confederation) and to SABU. BPSU membership requires paid-up SABU membership.",
    "kind": "both",
    "requirement": "BPSU regulates competitive shooting of historical firearms from the flintlock era of the 1700s up to and including pre-1919 service arms, together with reproductions of them, under MLAIC rules. The firearm requirement is therefore expressed as an event class named for the historic arm type rather than as a calibre or weight limit: the officially recognised BPSU rifle records run over Vetterli (free rifle) and Lamarmora (military rifle) at 50 m, Pennsylvania (flintlock rifle), Hawken in Traditional, Modern and Open forms, Trapper, in-line muzzleloader classes, Miquelet (smoothbore flintlock) at 50 yards, and Whitworth (free rifle), Walkyrie and Minié (military rifle) at 100 m. Original and reproduction arms are classified separately. ⚠️ BPSU's own rulebook was not retrievable online — the class names above are taken from BPSU's published national records; the underlying dimensional and propellant rules are MLAIC's.",
    "sources": [
      "http://www.bpsu.co.za/BPSU_Results/2025/BPSU%20Records%202025.pdf",
      "http://bpsu.co.za/BPSU_History.htm"
    ]
  },
  {
    "value": "muzzle-loading-pistol-and-revolver",
    "label": "Muzzle-Loading Pistol and Revolver",
    "group": "Historical and black powder shooting",
    "body": "BPSU / MLAIC - Type: SPORT SHOOTING",
    "kind": "sport",
    "requirement": "The handgun events are again defined by arm type: Kuchenreuter (single-shot percussion pistol) and Cominazzo (flintlock pistol) at 25 m, Mariette / Colt (percussion revolver) and Patterson (open-frame revolver) at 25 m, Classic Handgun, Single Shot Pistol and Revolver at 25 yards, and Donald Malson (revolver) and Single Shot Pistol at 50 m. Single-action operation and period-correct or reproduction pattern is inherent in each class. ⚠️ Same caveat as above — class names verified from BPSU records; detailed specifications are in the MLAIC rulebook, not retrieved.",
    "sources": []
  },
  {
    "value": "muzzle-loading-shotgun",
    "label": "Muzzle-Loading Shotgun",
    "group": "Historical and black powder shooting",
    "body": "BPSU / MLAIC - Type: BOTH",
    "kind": "sport",
    "requirement": "Two muzzle-loading shotgun classes are recognised — Lorenzoni (percussion) and Manton (flintlock) — alongside a Breechloading Shotgun class. The class name determines the ignition system required of the gun.",
    "sources": []
  },
  {
    "value": "historical-breech-loading-rifle-long-range-historical-rifle",
    "label": "Historical Breech-Loading Rifle / Long-Range Historical Rifle",
    "group": "Historical and black powder shooting",
    "body": "BPSU; long-range events under the World Long Range Historical Rifle Shooting Association, whose rules BPSU helped draft.",
    "kind": "sport",
    "requirement": "The breech-loading classes are defined by the historic action: Snider .577, Martini / Small Bore Breechloader, Free Breechloader, Any .303, and Bolt Action Military Service Rifle at 50 m and 100 m. Long-range historical rifle events are fired at 300, 500, 600, 800, 900 and 1 000 yards/metres, in separate original and reproduction classes, with .451-calibre muzzle loaders and period breechloaders both in use.",
    "sources": []
  },
  {
    "value": "narfo-postal-sport-shooting",
    "label": "NARFO Postal Sport Shooting",
    "group": "Association in-house postal shooting",
    "body": "NARFO (National Association of Responsible Firearm Owners of South Africa)",
    "kind": "both",
    "requirement": "NARFO's postal programme is organised by firearm type rather than by an equipment specification, and the shooter selects the firearm type for each event: CFRBA (any centrefire bolt-action rifle), RFRBA (any rimfire bolt-action rifle), CFRSA and RFRSA (centrefire and rimfire semi-auto/self-loading rifles), CFHGP/CFHGR (centrefire pistol / revolver), RFHGP/RFHGR (rimfire pistol / revolver), BBRBA and BBRBN (big bore, 9.3 mm and larger, bolt action or break action), SGH (shotgun hunting — over-and-under, side-by-side, pump), SGSA (semi-auto shotgun), BPR and BPHG (black powder rifle and handgun), CFHHG (centrefire hunting handgun), LAR (lever-action rifle), PCC (pistol calibre carbine), and ARS/AHS (air rifle and air handgun, PCP or spring). Individual events then set the distance, shot count, target and the support permitted rather than constraining the gun: the Practical Assessment, for example, is shot from the bench with any firearm and any optic, front rest and bipod allowed, requiring at least 70%; the CFRBA Accuracy Test is bench-shot at 100 m with two fouling shots plus eight scoring shots in two positions. Ranking requires three targets with the same firearm category and discipline on three different occasions; dedicated status maintenance requires a minimum of two activities per year.",
    "sources": [
      "https://portal.narfo.co.za/uploads/2020/12/NARFO%20Sport%20Shooting%20Rules%20(J",
      "https://narfo.co.za/sport-shooting-rules/"
    ]
  },
  {
    "value": "olympic-trap",
    "label": "Olympic Trap",
    "group": "Clay target shooting",
    "body": "CTSASA (Clay Target Shooting Association of South Africa), an SASSCo affiliate accredited to issue dedicated membership certificates for both dedicated sport shooting and dedicated hunter. Compak Sporting is administered by COMPAK SA.",
    "kind": "sport",
    "requirement": "Clay target disciplines constrain the *cartridge* far more tightly than the gun. CTSASA publishes a per-discipline ammunition specification: maximum 24 g load for Olympic Trap, Olympic Double Trap and Olympic Skeet; 28 g for DTL Trap (max 2.6 mm shot), English Sporting (max 2.6 mm), English Skeet, FITASC Sporting, FITASC Universal Trench, FITASC Auto Trap 300 and FITASC TRAP1 (FITASC disciplines additionally require spherical shot between 2.0 and 2.5 mm with a 0.1 mm tolerance); and 32 g for ATA Trap and ATA Trap Doubles (max shot size 7½ / 2.4 mm at a maximum velocity of 1 290 fps, rising to 1 325 fps for 28 g and 1 350 fps for 24 g), NSSA Skeet, NSSA Skeet Doubles and 5-Stand Sporting (2.0–2.50 mm). The gun is normally a 12-gauge over-and-under, side-by-side, semi-automatic or pump; the discipline-defining constraint is that ATA Trap permits only one cartridge to be loaded per single target while DTL Trap permits both barrels, and Olympic Trap and Universal Trench are shot over a trench of trap machines rather than a single trap.",
    "sources": [
      "https://ctsasa.co.za/rules/",
      "https://ctsasa.co.za/clay-target-shooting-disciplines/"
    ]
  },
  {
    "value": "olympic-double-trap",
    "label": "Olympic Double Trap",
    "group": "Clay target shooting",
    "body": "CTSASA (Clay Target Shooting Association of South Africa), an SASSCo affiliate accredited to issue dedicated membership certificates for both dedicated sport shooting and dedicated hunter. Compak Sporting is administered by COMPAK SA.",
    "kind": "sport",
    "requirement": "Clay target disciplines constrain the *cartridge* far more tightly than the gun. CTSASA publishes a per-discipline ammunition specification: maximum 24 g load for Olympic Trap, Olympic Double Trap and Olympic Skeet; 28 g for DTL Trap (max 2.6 mm shot), English Sporting (max 2.6 mm), English Skeet, FITASC Sporting, FITASC Universal Trench, FITASC Auto Trap 300 and FITASC TRAP1 (FITASC disciplines additionally require spherical shot between 2.0 and 2.5 mm with a 0.1 mm tolerance); and 32 g for ATA Trap and ATA Trap Doubles (max shot size 7½ / 2.4 mm at a maximum velocity of 1 290 fps, rising to 1 325 fps for 28 g and 1 350 fps for 24 g), NSSA Skeet, NSSA Skeet Doubles and 5-Stand Sporting (2.0–2.50 mm). The gun is normally a 12-gauge over-and-under, side-by-side, semi-automatic or pump; the discipline-defining constraint is that ATA Trap permits only one cartridge to be loaded per single target while DTL Trap permits both barrels, and Olympic Trap and Universal Trench are shot over a trench of trap machines rather than a single trap.",
    "sources": [
      "https://ctsasa.co.za/rules/",
      "https://ctsasa.co.za/clay-target-shooting-disciplines/"
    ]
  },
  {
    "value": "universal-trench",
    "label": "Universal Trench",
    "group": "Clay target shooting",
    "body": "CTSASA (Clay Target Shooting Association of South Africa), an SASSCo affiliate accredited to issue dedicated membership certificates for both dedicated sport shooting and dedicated hunter. Compak Sporting is administered by COMPAK SA.",
    "kind": "sport",
    "requirement": "Clay target disciplines constrain the *cartridge* far more tightly than the gun. CTSASA publishes a per-discipline ammunition specification: maximum 24 g load for Olympic Trap, Olympic Double Trap and Olympic Skeet; 28 g for DTL Trap (max 2.6 mm shot), English Sporting (max 2.6 mm), English Skeet, FITASC Sporting, FITASC Universal Trench, FITASC Auto Trap 300 and FITASC TRAP1 (FITASC disciplines additionally require spherical shot between 2.0 and 2.5 mm with a 0.1 mm tolerance); and 32 g for ATA Trap and ATA Trap Doubles (max shot size 7½ / 2.4 mm at a maximum velocity of 1 290 fps, rising to 1 325 fps for 28 g and 1 350 fps for 24 g), NSSA Skeet, NSSA Skeet Doubles and 5-Stand Sporting (2.0–2.50 mm). The gun is normally a 12-gauge over-and-under, side-by-side, semi-automatic or pump; the discipline-defining constraint is that ATA Trap permits only one cartridge to be loaded per single target while DTL Trap permits both barrels, and Olympic Trap and Universal Trench are shot over a trench of trap machines rather than a single trap.",
    "sources": [
      "https://ctsasa.co.za/rules/",
      "https://ctsasa.co.za/clay-target-shooting-disciplines/"
    ]
  },
  {
    "value": "fitasc-trap1",
    "label": "FITASC TRAP1",
    "group": "Clay target shooting",
    "body": "CTSASA (Clay Target Shooting Association of South Africa), an SASSCo affiliate accredited to issue dedicated membership certificates for both dedicated sport shooting and dedicated hunter. Compak Sporting is administered by COMPAK SA.",
    "kind": "sport",
    "requirement": "Clay target disciplines constrain the *cartridge* far more tightly than the gun. CTSASA publishes a per-discipline ammunition specification: maximum 24 g load for Olympic Trap, Olympic Double Trap and Olympic Skeet; 28 g for DTL Trap (max 2.6 mm shot), English Sporting (max 2.6 mm), English Skeet, FITASC Sporting, FITASC Universal Trench, FITASC Auto Trap 300 and FITASC TRAP1 (FITASC disciplines additionally require spherical shot between 2.0 and 2.5 mm with a 0.1 mm tolerance); and 32 g for ATA Trap and ATA Trap Doubles (max shot size 7½ / 2.4 mm at a maximum velocity of 1 290 fps, rising to 1 325 fps for 28 g and 1 350 fps for 24 g), NSSA Skeet, NSSA Skeet Doubles and 5-Stand Sporting (2.0–2.50 mm). The gun is normally a 12-gauge over-and-under, side-by-side, semi-automatic or pump; the discipline-defining constraint is that ATA Trap permits only one cartridge to be loaded per single target while DTL Trap permits both barrels, and Olympic Trap and Universal Trench are shot over a trench of trap machines rather than a single trap.",
    "sources": [
      "https://ctsasa.co.za/rules/",
      "https://ctsasa.co.za/clay-target-shooting-disciplines/"
    ]
  },
  {
    "value": "ata-trap",
    "label": "ATA Trap",
    "group": "Clay target shooting",
    "body": "CTSASA (Clay Target Shooting Association of South Africa), an SASSCo affiliate accredited to issue dedicated membership certificates for both dedicated sport shooting and dedicated hunter. Compak Sporting is administered by COMPAK SA.",
    "kind": "sport",
    "requirement": "Clay target disciplines constrain the *cartridge* far more tightly than the gun. CTSASA publishes a per-discipline ammunition specification: maximum 24 g load for Olympic Trap, Olympic Double Trap and Olympic Skeet; 28 g for DTL Trap (max 2.6 mm shot), English Sporting (max 2.6 mm), English Skeet, FITASC Sporting, FITASC Universal Trench, FITASC Auto Trap 300 and FITASC TRAP1 (FITASC disciplines additionally require spherical shot between 2.0 and 2.5 mm with a 0.1 mm tolerance); and 32 g for ATA Trap and ATA Trap Doubles (max shot size 7½ / 2.4 mm at a maximum velocity of 1 290 fps, rising to 1 325 fps for 28 g and 1 350 fps for 24 g), NSSA Skeet, NSSA Skeet Doubles and 5-Stand Sporting (2.0–2.50 mm). The gun is normally a 12-gauge over-and-under, side-by-side, semi-automatic or pump; the discipline-defining constraint is that ATA Trap permits only one cartridge to be loaded per single target while DTL Trap permits both barrels, and Olympic Trap and Universal Trench are shot over a trench of trap machines rather than a single trap.",
    "sources": [
      "https://ctsasa.co.za/rules/",
      "https://ctsasa.co.za/clay-target-shooting-disciplines/"
    ]
  },
  {
    "value": "ata-trap-doubles",
    "label": "ATA Trap Doubles",
    "group": "Clay target shooting",
    "body": "CTSASA (Clay Target Shooting Association of South Africa), an SASSCo affiliate accredited to issue dedicated membership certificates for both dedicated sport shooting and dedicated hunter. Compak Sporting is administered by COMPAK SA.",
    "kind": "sport",
    "requirement": "Clay target disciplines constrain the *cartridge* far more tightly than the gun. CTSASA publishes a per-discipline ammunition specification: maximum 24 g load for Olympic Trap, Olympic Double Trap and Olympic Skeet; 28 g for DTL Trap (max 2.6 mm shot), English Sporting (max 2.6 mm), English Skeet, FITASC Sporting, FITASC Universal Trench, FITASC Auto Trap 300 and FITASC TRAP1 (FITASC disciplines additionally require spherical shot between 2.0 and 2.5 mm with a 0.1 mm tolerance); and 32 g for ATA Trap and ATA Trap Doubles (max shot size 7½ / 2.4 mm at a maximum velocity of 1 290 fps, rising to 1 325 fps for 28 g and 1 350 fps for 24 g), NSSA Skeet, NSSA Skeet Doubles and 5-Stand Sporting (2.0–2.50 mm). The gun is normally a 12-gauge over-and-under, side-by-side, semi-automatic or pump; the discipline-defining constraint is that ATA Trap permits only one cartridge to be loaded per single target while DTL Trap permits both barrels, and Olympic Trap and Universal Trench are shot over a trench of trap machines rather than a single trap.",
    "sources": [
      "https://ctsasa.co.za/rules/",
      "https://ctsasa.co.za/clay-target-shooting-disciplines/"
    ]
  },
  {
    "value": "dtl-trap",
    "label": "DTL Trap",
    "group": "Clay target shooting",
    "body": "CTSASA (Clay Target Shooting Association of South Africa), an SASSCo affiliate accredited to issue dedicated membership certificates for both dedicated sport shooting and dedicated hunter. Compak Sporting is administered by COMPAK SA.",
    "kind": "sport",
    "requirement": "Clay target disciplines constrain the *cartridge* far more tightly than the gun. CTSASA publishes a per-discipline ammunition specification: maximum 24 g load for Olympic Trap, Olympic Double Trap and Olympic Skeet; 28 g for DTL Trap (max 2.6 mm shot), English Sporting (max 2.6 mm), English Skeet, FITASC Sporting, FITASC Universal Trench, FITASC Auto Trap 300 and FITASC TRAP1 (FITASC disciplines additionally require spherical shot between 2.0 and 2.5 mm with a 0.1 mm tolerance); and 32 g for ATA Trap and ATA Trap Doubles (max shot size 7½ / 2.4 mm at a maximum velocity of 1 290 fps, rising to 1 325 fps for 28 g and 1 350 fps for 24 g), NSSA Skeet, NSSA Skeet Doubles and 5-Stand Sporting (2.0–2.50 mm). The gun is normally a 12-gauge over-and-under, side-by-side, semi-automatic or pump; the discipline-defining constraint is that ATA Trap permits only one cartridge to be loaded per single target while DTL Trap permits both barrels, and Olympic Trap and Universal Trench are shot over a trench of trap machines rather than a single trap.",
    "sources": [
      "https://ctsasa.co.za/rules/",
      "https://ctsasa.co.za/clay-target-shooting-disciplines/"
    ]
  },
  {
    "value": "double-rise",
    "label": "Double-Rise",
    "group": "Clay target shooting",
    "body": "CTSASA (Clay Target Shooting Association of South Africa), an SASSCo affiliate accredited to issue dedicated membership certificates for both dedicated sport shooting and dedicated hunter. Compak Sporting is administered by COMPAK SA.",
    "kind": "sport",
    "requirement": "Clay target disciplines constrain the *cartridge* far more tightly than the gun. CTSASA publishes a per-discipline ammunition specification: maximum 24 g load for Olympic Trap, Olympic Double Trap and Olympic Skeet; 28 g for DTL Trap (max 2.6 mm shot), English Sporting (max 2.6 mm), English Skeet, FITASC Sporting, FITASC Universal Trench, FITASC Auto Trap 300 and FITASC TRAP1 (FITASC disciplines additionally require spherical shot between 2.0 and 2.5 mm with a 0.1 mm tolerance); and 32 g for ATA Trap and ATA Trap Doubles (max shot size 7½ / 2.4 mm at a maximum velocity of 1 290 fps, rising to 1 325 fps for 28 g and 1 350 fps for 24 g), NSSA Skeet, NSSA Skeet Doubles and 5-Stand Sporting (2.0–2.50 mm). The gun is normally a 12-gauge over-and-under, side-by-side, semi-automatic or pump; the discipline-defining constraint is that ATA Trap permits only one cartridge to be loaded per single target while DTL Trap permits both barrels, and Olympic Trap and Universal Trench are shot over a trench of trap machines rather than a single trap.",
    "sources": [
      "https://ctsasa.co.za/rules/",
      "https://ctsasa.co.za/clay-target-shooting-disciplines/"
    ]
  },
  {
    "value": "olympic-skeet",
    "label": "Olympic Skeet",
    "group": "Clay target shooting",
    "body": "CTSASA (Clay Target Shooting Association of South Africa), an SASSCo affiliate accredited to issue dedicated membership certificates for both dedicated sport shooting and dedicated hunter. Compak Sporting is administered by COMPAK SA.",
    "kind": "sport",
    "requirement": "Clay target disciplines constrain the *cartridge* far more tightly than the gun. CTSASA publishes a per-discipline ammunition specification: maximum 24 g load for Olympic Trap, Olympic Double Trap and Olympic Skeet; 28 g for DTL Trap (max 2.6 mm shot), English Sporting (max 2.6 mm), English Skeet, FITASC Sporting, FITASC Universal Trench, FITASC Auto Trap 300 and FITASC TRAP1 (FITASC disciplines additionally require spherical shot between 2.0 and 2.5 mm with a 0.1 mm tolerance); and 32 g for ATA Trap and ATA Trap Doubles (max shot size 7½ / 2.4 mm at a maximum velocity of 1 290 fps, rising to 1 325 fps for 28 g and 1 350 fps for 24 g), NSSA Skeet, NSSA Skeet Doubles and 5-Stand Sporting (2.0–2.50 mm). The gun is normally a 12-gauge over-and-under, side-by-side, semi-automatic or pump; the discipline-defining constraint is that ATA Trap permits only one cartridge to be loaded per single target while DTL Trap permits both barrels, and Olympic Trap and Universal Trench are shot over a trench of trap machines rather than a single trap.",
    "sources": [
      "https://ctsasa.co.za/rules/",
      "https://ctsasa.co.za/clay-target-shooting-disciplines/"
    ]
  },
  {
    "value": "english-skeet",
    "label": "English Skeet",
    "group": "Clay target shooting",
    "body": "CTSASA (Clay Target Shooting Association of South Africa), an SASSCo affiliate accredited to issue dedicated membership certificates for both dedicated sport shooting and dedicated hunter. Compak Sporting is administered by COMPAK SA.",
    "kind": "sport",
    "requirement": "Clay target disciplines constrain the *cartridge* far more tightly than the gun. CTSASA publishes a per-discipline ammunition specification: maximum 24 g load for Olympic Trap, Olympic Double Trap and Olympic Skeet; 28 g for DTL Trap (max 2.6 mm shot), English Sporting (max 2.6 mm), English Skeet, FITASC Sporting, FITASC Universal Trench, FITASC Auto Trap 300 and FITASC TRAP1 (FITASC disciplines additionally require spherical shot between 2.0 and 2.5 mm with a 0.1 mm tolerance); and 32 g for ATA Trap and ATA Trap Doubles (max shot size 7½ / 2.4 mm at a maximum velocity of 1 290 fps, rising to 1 325 fps for 28 g and 1 350 fps for 24 g), NSSA Skeet, NSSA Skeet Doubles and 5-Stand Sporting (2.0–2.50 mm). The gun is normally a 12-gauge over-and-under, side-by-side, semi-automatic or pump; the discipline-defining constraint is that ATA Trap permits only one cartridge to be loaded per single target while DTL Trap permits both barrels, and Olympic Trap and Universal Trench are shot over a trench of trap machines rather than a single trap.",
    "sources": [
      "https://ctsasa.co.za/rules/",
      "https://ctsasa.co.za/clay-target-shooting-disciplines/"
    ]
  },
  {
    "value": "nssa-skeet",
    "label": "NSSA Skeet",
    "group": "Clay target shooting",
    "body": "CTSASA (Clay Target Shooting Association of South Africa), an SASSCo affiliate accredited to issue dedicated membership certificates for both dedicated sport shooting and dedicated hunter. Compak Sporting is administered by COMPAK SA.",
    "kind": "sport",
    "requirement": "Clay target disciplines constrain the *cartridge* far more tightly than the gun. CTSASA publishes a per-discipline ammunition specification: maximum 24 g load for Olympic Trap, Olympic Double Trap and Olympic Skeet; 28 g for DTL Trap (max 2.6 mm shot), English Sporting (max 2.6 mm), English Skeet, FITASC Sporting, FITASC Universal Trench, FITASC Auto Trap 300 and FITASC TRAP1 (FITASC disciplines additionally require spherical shot between 2.0 and 2.5 mm with a 0.1 mm tolerance); and 32 g for ATA Trap and ATA Trap Doubles (max shot size 7½ / 2.4 mm at a maximum velocity of 1 290 fps, rising to 1 325 fps for 28 g and 1 350 fps for 24 g), NSSA Skeet, NSSA Skeet Doubles and 5-Stand Sporting (2.0–2.50 mm). The gun is normally a 12-gauge over-and-under, side-by-side, semi-automatic or pump; the discipline-defining constraint is that ATA Trap permits only one cartridge to be loaded per single target while DTL Trap permits both barrels, and Olympic Trap and Universal Trench are shot over a trench of trap machines rather than a single trap.",
    "sources": [
      "https://ctsasa.co.za/rules/",
      "https://ctsasa.co.za/clay-target-shooting-disciplines/"
    ]
  },
  {
    "value": "nssa-skeet-doubles",
    "label": "NSSA Skeet Doubles",
    "group": "Clay target shooting",
    "body": "CTSASA (Clay Target Shooting Association of South Africa), an SASSCo affiliate accredited to issue dedicated membership certificates for both dedicated sport shooting and dedicated hunter. Compak Sporting is administered by COMPAK SA.",
    "kind": "sport",
    "requirement": "Clay target disciplines constrain the *cartridge* far more tightly than the gun. CTSASA publishes a per-discipline ammunition specification: maximum 24 g load for Olympic Trap, Olympic Double Trap and Olympic Skeet; 28 g for DTL Trap (max 2.6 mm shot), English Sporting (max 2.6 mm), English Skeet, FITASC Sporting, FITASC Universal Trench, FITASC Auto Trap 300 and FITASC TRAP1 (FITASC disciplines additionally require spherical shot between 2.0 and 2.5 mm with a 0.1 mm tolerance); and 32 g for ATA Trap and ATA Trap Doubles (max shot size 7½ / 2.4 mm at a maximum velocity of 1 290 fps, rising to 1 325 fps for 28 g and 1 350 fps for 24 g), NSSA Skeet, NSSA Skeet Doubles and 5-Stand Sporting (2.0–2.50 mm). The gun is normally a 12-gauge over-and-under, side-by-side, semi-automatic or pump; the discipline-defining constraint is that ATA Trap permits only one cartridge to be loaded per single target while DTL Trap permits both barrels, and Olympic Trap and Universal Trench are shot over a trench of trap machines rather than a single trap.",
    "sources": [
      "https://ctsasa.co.za/rules/",
      "https://ctsasa.co.za/clay-target-shooting-disciplines/"
    ]
  },
  {
    "value": "english-sporting",
    "label": "English Sporting",
    "group": "Clay target shooting",
    "body": "CTSASA (Clay Target Shooting Association of South Africa), an SASSCo affiliate accredited to issue dedicated membership certificates for both dedicated sport shooting and dedicated hunter. Compak Sporting is administered by COMPAK SA.",
    "kind": "sport",
    "requirement": "Clay target disciplines constrain the *cartridge* far more tightly than the gun. CTSASA publishes a per-discipline ammunition specification: maximum 24 g load for Olympic Trap, Olympic Double Trap and Olympic Skeet; 28 g for DTL Trap (max 2.6 mm shot), English Sporting (max 2.6 mm), English Skeet, FITASC Sporting, FITASC Universal Trench, FITASC Auto Trap 300 and FITASC TRAP1 (FITASC disciplines additionally require spherical shot between 2.0 and 2.5 mm with a 0.1 mm tolerance); and 32 g for ATA Trap and ATA Trap Doubles (max shot size 7½ / 2.4 mm at a maximum velocity of 1 290 fps, rising to 1 325 fps for 28 g and 1 350 fps for 24 g), NSSA Skeet, NSSA Skeet Doubles and 5-Stand Sporting (2.0–2.50 mm). The gun is normally a 12-gauge over-and-under, side-by-side, semi-automatic or pump; the discipline-defining constraint is that ATA Trap permits only one cartridge to be loaded per single target while DTL Trap permits both barrels, and Olympic Trap and Universal Trench are shot over a trench of trap machines rather than a single trap.",
    "sources": [
      "https://ctsasa.co.za/rules/",
      "https://ctsasa.co.za/clay-target-shooting-disciplines/"
    ]
  },
  {
    "value": "fitasc-sporting",
    "label": "FITASC Sporting",
    "group": "Clay target shooting",
    "body": "CTSASA (Clay Target Shooting Association of South Africa), an SASSCo affiliate accredited to issue dedicated membership certificates for both dedicated sport shooting and dedicated hunter. Compak Sporting is administered by COMPAK SA.",
    "kind": "sport",
    "requirement": "Clay target disciplines constrain the *cartridge* far more tightly than the gun. CTSASA publishes a per-discipline ammunition specification: maximum 24 g load for Olympic Trap, Olympic Double Trap and Olympic Skeet; 28 g for DTL Trap (max 2.6 mm shot), English Sporting (max 2.6 mm), English Skeet, FITASC Sporting, FITASC Universal Trench, FITASC Auto Trap 300 and FITASC TRAP1 (FITASC disciplines additionally require spherical shot between 2.0 and 2.5 mm with a 0.1 mm tolerance); and 32 g for ATA Trap and ATA Trap Doubles (max shot size 7½ / 2.4 mm at a maximum velocity of 1 290 fps, rising to 1 325 fps for 28 g and 1 350 fps for 24 g), NSSA Skeet, NSSA Skeet Doubles and 5-Stand Sporting (2.0–2.50 mm). The gun is normally a 12-gauge over-and-under, side-by-side, semi-automatic or pump; the discipline-defining constraint is that ATA Trap permits only one cartridge to be loaded per single target while DTL Trap permits both barrels, and Olympic Trap and Universal Trench are shot over a trench of trap machines rather than a single trap.",
    "sources": [
      "https://ctsasa.co.za/rules/",
      "https://ctsasa.co.za/clay-target-shooting-disciplines/"
    ]
  },
  {
    "value": "5-stand-sporting",
    "label": "5-Stand Sporting",
    "group": "Clay target shooting",
    "body": "CTSASA (Clay Target Shooting Association of South Africa), an SASSCo affiliate accredited to issue dedicated membership certificates for both dedicated sport shooting and dedicated hunter. Compak Sporting is administered by COMPAK SA.",
    "kind": "sport",
    "requirement": "Clay target disciplines constrain the *cartridge* far more tightly than the gun. CTSASA publishes a per-discipline ammunition specification: maximum 24 g load for Olympic Trap, Olympic Double Trap and Olympic Skeet; 28 g for DTL Trap (max 2.6 mm shot), English Sporting (max 2.6 mm), English Skeet, FITASC Sporting, FITASC Universal Trench, FITASC Auto Trap 300 and FITASC TRAP1 (FITASC disciplines additionally require spherical shot between 2.0 and 2.5 mm with a 0.1 mm tolerance); and 32 g for ATA Trap and ATA Trap Doubles (max shot size 7½ / 2.4 mm at a maximum velocity of 1 290 fps, rising to 1 325 fps for 28 g and 1 350 fps for 24 g), NSSA Skeet, NSSA Skeet Doubles and 5-Stand Sporting (2.0–2.50 mm). The gun is normally a 12-gauge over-and-under, side-by-side, semi-automatic or pump; the discipline-defining constraint is that ATA Trap permits only one cartridge to be loaded per single target while DTL Trap permits both barrels, and Olympic Trap and Universal Trench are shot over a trench of trap machines rather than a single trap.",
    "sources": [
      "https://ctsasa.co.za/rules/",
      "https://ctsasa.co.za/clay-target-shooting-disciplines/"
    ]
  },
  {
    "value": "compak-sporting",
    "label": "Compak Sporting",
    "group": "Clay target shooting",
    "body": "CTSASA (Clay Target Shooting Association of South Africa), an SASSCo affiliate accredited to issue dedicated membership certificates for both dedicated sport shooting and dedicated hunter. Compak Sporting is administered by COMPAK SA.",
    "kind": "sport",
    "requirement": "Clay target disciplines constrain the *cartridge* far more tightly than the gun. CTSASA publishes a per-discipline ammunition specification: maximum 24 g load for Olympic Trap, Olympic Double Trap and Olympic Skeet; 28 g for DTL Trap (max 2.6 mm shot), English Sporting (max 2.6 mm), English Skeet, FITASC Sporting, FITASC Universal Trench, FITASC Auto Trap 300 and FITASC TRAP1 (FITASC disciplines additionally require spherical shot between 2.0 and 2.5 mm with a 0.1 mm tolerance); and 32 g for ATA Trap and ATA Trap Doubles (max shot size 7½ / 2.4 mm at a maximum velocity of 1 290 fps, rising to 1 325 fps for 28 g and 1 350 fps for 24 g), NSSA Skeet, NSSA Skeet Doubles and 5-Stand Sporting (2.0–2.50 mm). The gun is normally a 12-gauge over-and-under, side-by-side, semi-automatic or pump; the discipline-defining constraint is that ATA Trap permits only one cartridge to be loaded per single target while DTL Trap permits both barrels, and Olympic Trap and Universal Trench are shot over a trench of trap machines rather than a single trap.",
    "sources": [
      "https://ctsasa.co.za/rules/",
      "https://ctsasa.co.za/clay-target-shooting-disciplines/"
    ]
  }
];

/** Dropdown order, grouped, with "Something else" last. */
export function disciplineGroups(): { group: string; options: ShootingDiscipline[] }[] {
  const out: { group: string; options: ShootingDiscipline[] }[] = [];
  for (const d of SHOOTING_DISCIPLINES) {
    let g = out.find((x) => x.group === d.group);
    if (!g) {
      g = { group: d.group, options: [] };
      out.push(g);
    }
    g.options.push(d);
  }
  return out;
}

export function disciplineByValue(value: string): ShootingDiscipline | null {
  return SHOOTING_DISCIPLINES.find((d) => d.value === value) ?? null;
}
