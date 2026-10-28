import { MotivationLicenceType } from '@prisma/client';
import { MotivationSuitabilityService } from './motivation-suitability.service';
import type { SuitabilityInput } from './motivation-suitability';

const input: SuitabilityInput = {
  licenceType: MotivationLicenceType.S13_SELF_DEFENCE,
  answers: {
    firearm_make: 'Glock',
    firearm_model: '43X',
    firearm_calibre: '9mm Parabellum',
    firearm_type: 'Handgun',
    residence_type: 'Townhouse or complex',
    police_station: 'Durbanville',
    safe_key_holder: 'Only me',
    s13_carry_style: 'On my person',
  },
  research: [
    'THE FIREARM APPLIED FOR:',
    'A compact handgun for close-range defence.',
    'THE CARTRIDGE APPLIED FOR:',
    'The 9mm service cartridge has adequate stopping power and less over-penetration than a rifle round.',
  ].join('\n'),
  exhibits: ['A home at night'],
  firearmLine: 'Glock 43X · 9mm Parabellum',
  arsenal: [],
};

function bullet(text: string): string {
  return `${text} This suits this application and the risk.`;
}

function draft(overrides: Partial<Record<string, string>> = {}) {
  const groups = [
    {
      heading: 'The firearm',
      bullets: [
        bullet(
          'The Glock 43X is a compact handgun I can keep on my person through the rooms of the townhouse.',
        ),
        bullet(
          'A long gun cannot be turned in the passage where the encounter happens in this home.',
        ),
        bullet(
          'The handgun fits the safe I described and stays under my control as the key holder.',
        ),
        bullet(
          'I can carry it from the complex gate to my front door, where I am exposed after dark.',
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
          'Its over-penetration risk is lower than a rifle round, which matters because a townhouse shares walls.',
        ),
        bullet(
          'Recoil is manageable, so I can practise and place follow-up shots under pressure.',
        ),
        bullet(
          'I practise with the firearm regularly, and that practice makes it usable when the need arises.',
        ),
      ],
    },
    {
      heading: 'The townhouse and my routine',
      bullets: [
        bullet(
          'My home is a townhouse in a complex, so the encounter is at the gate or inside a room.',
        ),
        bullet(
          'The alarm and armed response are minutes away, while an attack is measured in seconds.',
        ),
        bullet(
          'The safe and the key are mine alone, so the firearm is secure and still available.',
        ),
        bullet(
          'I keep it on my person at home, which is where the risk I described actually occurs.',
        ),
      ],
    },
    {
      heading: 'Why the alternatives fall short',
      bullets: [
        bullet(
          'A rifle has more stopping power but over-penetrates the shared walls and cannot be used in a passage.',
        ),
        bullet(
          'A shotgun is harder to store and bring into action in the rooms of this townhouse.',
        ),
        bullet(
          'A smaller calibre would reduce over-penetration but would not give me the stopping power I need.',
        ),
        bullet(
          'The handgun is the class I can keep, carry and use in the space where the attack happens.',
        ),
      ],
    },
  ];
  return {
    question: 'Why is the Glock 43X, chambered in 9mm Parabellum, suited for self-defence inside a townhouse?',
    thesis:
      'I choose the Glock 43X in 9mm because it is the firearm and cartridge I can keep, carry and use where the risk occurs.',
    groups,
    wordCount: 0,
    ...overrides,
  };
}

function llmWith(replies: unknown[]) {
  let n = 0;
  const complete = jest.fn(async () => {
    const reply = replies[Math.min(n, replies.length - 1)];
    n += 1;
    return {
      text: typeof reply === 'string' ? reply : JSON.stringify(reply),
    };
  });
  return {
    isConfigured: () => true,
    complete,
  } as never;
}

describe('MotivationSuitabilityService', () => {
  it('writes the argument in one call and returns its fact hash', async () => {
    const llm = llmWith([draft()]);
    const svc = new MotivationSuitabilityService(llm);
    const out = await svc.build(input);
    expect(out).not.toBeNull();
    expect(out!.argument.question).toContain('Glock 43X');
    expect(out!.argument.groups.length).toBe(4);
    expect(out!.hash).toMatch(/^[a-f0-9]{64}$/);
    const call = (llm as unknown as { complete: jest.Mock }).complete.mock
      .calls[0][0];
    expect(call.purpose).toBe('motivation.suitability');
    expect(call.json.schema).toBeTruthy();
  });

  it('retries once when our validator refuses the first draft', async () => {
    const noStoppingPower = draft();
    noStoppingPower.groups = noStoppingPower.groups.map((g) => ({
      ...g,
      bullets: g.bullets.filter((b) => !/stopping power/i.test(b)),
    }));
    const llm = llmWith([noStoppingPower, draft()]);
    const svc = new MotivationSuitabilityService(llm);
    const out = await svc.build(input);
    expect(out).not.toBeNull();
    expect(
      (llm as unknown as { complete: jest.Mock }).complete,
    ).toHaveBeenCalledTimes(2);
  });

  it('returns null after two refused drafts', async () => {
    const noStoppingPower = draft();
    noStoppingPower.groups = noStoppingPower.groups.map((g) => ({
      ...g,
      bullets: g.bullets.filter((b) => !/stopping power/i.test(b)),
    }));
    const llm = llmWith([noStoppingPower, noStoppingPower]);
    const svc = new MotivationSuitabilityService(llm);
    expect(await svc.build(input)).toBeNull();
  });

  it('returns null when the provider is not configured', async () => {
    const svc = new MotivationSuitabilityService({
      isConfigured: () => false,
    } as never);
    expect(await svc.build(input)).toBeNull();
  });
});
