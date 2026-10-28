import { MotivationLicenceType } from '@prisma/client';
import {
  SUITABILITY_VERSION,
  buildSuitabilityFacts,
  buildSuitabilityQuestion,
  suitabilityHash,
  suitabilityPageLines,
  suitabilityResearch,
  suitabilitySituation,
  suitabilityPurpose,
  type SuitabilityArgument,
  type SuitabilityInput,
  validateSuitability,
} from './motivation-suitability';

const base: SuitabilityInput = {
  licenceType: MotivationLicenceType.S13_SELF_DEFENCE,
  answers: {
    firearm_make: 'Glock',
    firearm_model: '43X',
    firearm_calibre: '9mm Parabellum',
    firearm_type: 'Handgun',
    residence_type: 'Townhouse or complex',
    police_station: 'Durbanville',
    premises_enclosure: 'Wall, electric fence',
    armed_response: 'Yes',
    burglar_bars: 'Yes',
    security_gates: 'Yes',
    safe_present: 'Yes',
    safe_type: 'Rifle safe',
    safe_mounted: 'Yes',
    safe_mounted_to: 'Wall',
    safe_key_holder: 'Only me',
    s13_movements: 'Between home and work after dark',
    s13_carry_style: 'On my person',
    threat_circumstances: 'The complex gate is the point of exposure.',
  },
  research: [
    'THE FIREARM APPLIED FOR:',
    'A compact 9mm handgun used for close-range self-defence.',
    '',
    'THE CARTRIDGE APPLIED FOR:',
    'The 9mm service cartridge has adequate stopping power at close range, and it is less likely to over-penetrate a shared wall than a rifle round.',
  ].join('\n'),
  exhibits: ['A home at night'],
  firearmLine: 'Glock 43X · 9mm Parabellum',
  arsenal: [],
};

function validArgument(): SuitabilityArgument {
  const bullet = (text: string) => `${text} This suits this application and the risk.`;
  const groups = [
    {
      heading: 'The firearm',
      bullets: [
        bullet(
          'The Glock 43X is a compact handgun I can keep on my person through the passages and rooms of the townhouse.',
        ),
        bullet(
          'A long gun cannot be turned in the doorway or the passage where the encounter happens, so it is not available in the space.',
        ),
        bullet(
          'The handgun fits the safe I described and stays under my control as the only key holder.',
        ),
        bullet(
          'I can carry it from the complex gate to my front door, which is where I am most exposed after dark.',
        ),
      ],
    },
    {
      heading: 'The calibre',
      bullets: [
        bullet(
          'The 9mm service cartridge has the stopping power needed at the close ranges inside a home.',
        ),
        bullet(
          'Its over-penetration risk is lower than a rifle round, which matters because a townhouse shares walls with my neighbours.',
        ),
        bullet(
          'Recoil is manageable, so I can practise and place follow-up shots under pressure.',
        ),
        bullet(
          'I practice with the firearm regularly, and that practice is what makes it usable when the need arises.',
        ),
      ],
    },
    {
      heading: 'The townhouse and my routine',
      bullets: [
        bullet(
          'My home is a townhouse in a complex, so the encounter is at the gate, the parking area or inside a room.',
        ),
        bullet(
          'The alarm and armed response are minutes away, while an attack is measured in seconds.',
        ),
        bullet(
          'The safe and the key are mine alone, so the firearm is secure and still available where the risk occurs.',
        ),
      ],
    },
    {
      heading: 'Why the alternatives fall short',
      bullets: [
        bullet(
          'A rifle or shotgun has more stopping power but over-penetrates the shared walls and cannot be used in the passage.',
        ),
        bullet(
          'A smaller calibre would reduce over-penetration but would not give me the stopping power this defence needs.',
        ),
      ],
    },
  ];
  return {
    question: buildSuitabilityQuestion(base),
    thesis:
      'I choose the Glock 43X in 9mm because it is the firearm and cartridge I can keep, carry and use in the space where the risk occurs.',
    groups,
    wordCount: 0,
    version: SUITABILITY_VERSION,
  };
}

describe('the 5.2 suitability question', () => {
  it('asks the exact question for this firearm, calibre, purpose and home', () => {
    const q = buildSuitabilityQuestion(base);
    expect(q).toContain('Glock 43X');
    expect(q).toContain('9mm Parabellum');
    expect(q).toContain('self-defence');
    expect(q).toContain('townhouse');
  });

  it('omits placeholder model strings like NONE from the question', () => {
    const q = buildSuitabilityQuestion({
      ...base,
      answers: {
        ...base.answers,
        firearm_make: 'Nordiske Precision',
        firearm_model: 'NONE',
        firearm_calibre: '.223 Remington',
      },
    });
    expect(q).toContain('Why is the Nordiske Precision, chambered in .223 Remington');
    expect(q).not.toContain('NONE');
  });

  it('builds a hunting situation from the quarry and the ground', () => {
    const hunting: SuitabilityInput = {
      ...base,
      licenceType: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: {
        ...base.answers,
        firearm_make: 'Tikka',
        firearm_model: 'T3x',
        firearm_calibre: '.308 Winchester',
        firearm_type: 'Rifle',
        firearm_action: 'Bolt-action',
        intended_quarry: 'kudu and gemsbok',
        hunting_locations: 'the Eastern Cape bushveld',
      },
      exhibits: ['Kudu', 'Gemsbok'],
    };
    expect(suitabilityPurpose(hunting.licenceType, hunting.answers)).toBe(
      'hunting',
    );
    expect(suitabilitySituation(hunting)).toContain('kudu and gemsbok');
    expect(buildSuitabilityQuestion(hunting)).toContain('Eastern Cape');
  });

  it('builds a sport situation from the discipline', () => {
    const sport: SuitabilityInput = {
      ...base,
      licenceType: MotivationLicenceType.S16_DEDICATED_SPORT,
      answers: {
        ...base.answers,
        firearm_make: 'CZ',
        firearm_model: 'Shadow 2',
        competition_record: 'IPSC Production division',
        firearm_use_kind: 'Sport shooting',
      },
      exhibits: ['IPSC Production'],
    };
    expect(suitabilityPurpose(sport.licenceType, sport.answers)).toBe('sport');
    expect(buildSuitabilityQuestion(sport)).toContain('IPSC Production');
  });
});

describe('the facts and the research', () => {
  it('carries the premises, the routine and the safe', () => {
    const facts = buildSuitabilityFacts(base).join('\n');
    expect(facts).toContain('Townhouse or complex');
    expect(facts).toContain('Only me');
    expect(facts).toContain('On my person');
    expect(facts).toContain('Glock 43X');
  });

  it('reads the firearm and cartridge blocks, not the whole research blob', () => {
    const research = [
      'THE FIREARM APPLIED FOR:',
      'A compact handgun.',
      'THE CARTRIDGE APPLIED FOR:',
      'A service cartridge with stopping power.',
    ].join('\n');
    const out = suitabilityResearch(research);
    expect(out).toContain('compact handgun');
    expect(out).toContain('stopping power');
  });

  it('changes the hash when an answer changes', () => {
    const a = suitabilityHash(base);
    const b = suitabilityHash({
      ...base,
      answers: { ...base.answers, safe_key_holder: 'Me and one other person' },
    });
    expect(a).not.toBe(b);
  });
});

describe('validation', () => {
  it('accepts a grounded 400-word argument with stopping power and over-penetration', () => {
    const arg = validArgument();
    expect(validateSuitability(arg, base)).toEqual([]);
  });

  it('refuses a self-defence page with no stopping-power reason', () => {
    const arg = validArgument();
    arg.groups = arg.groups.map((g) => ({
      ...g,
      bullets: g.bullets.filter((b) => !/stopping power/i.test(b)),
    }));
    const issues = validateSuitability(arg, base);
    expect(issues).toContain('a self-defence page must argue stopping power');
  });

  it('refuses a self-defence page with no over-penetration reason', () => {
    const arg = validArgument();
    arg.groups = arg.groups.map((g) => ({
      ...g,
      bullets: g.bullets.filter(
        (b) => !/over.?penetrat|shared wall|neighbour/i.test(b),
      ),
    }));
    const issues = validateSuitability(arg, base);
    expect(issues.some((i) => /over-penetration/i.test(i))).toBe(true);
  });

  it('refuses velocity and capacity', () => {
    const arg = validArgument();
    arg.groups[1].bullets[0] =
      'The muzzle velocity and the magazine capacity are the reason I chose it.';
    const issues = validateSuitability(arg, base);
    expect(issues.some((i) => /specification|product phrase/i.test(i))).toBe(
      true,
    );
  });

  it('refuses a page that never names the firearm', () => {
    const arg = validArgument();
    arg.question = 'Why is this firearm suitable?';
    const issues = validateSuitability(arg, base);
    expect(issues.some((i) => i.includes('Glock'))).toBe(true);
  });

  it('renders grouped headings and bullets', () => {
    const lines = suitabilityPageLines(validArgument());
    expect(lines[0]).toContain('I choose the Glock');
    expect(lines).toContain('**The firearm**');
    expect(lines.some((l) => l.startsWith('- '))).toBe(true);
  });
});
