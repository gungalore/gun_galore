import { MotivationLicenceType } from '@prisma/client';
import type { LlmService } from '../common/llm/llm.service';
import type { LlmRequest } from '../common/llm/llm.types';
import type { LegalService } from '../legal/legal.service';
import { MotivationCaseResearchService } from './motivation-case-research.service';

const ANSWERS = {
  firearm_type: 'Rifle',
  firearm_action: 'Bolt action',
  firearm_make: 'Mauser',
  firearm_model: 'M96',
  firearm_calibre: '.30-06 Springfield',
  intended_quarry: 'Kudu',
  hunt_game_class: 'plains_medium',
  hunt_terrain: 'bushveld',
  hunting_locations: 'Limpopo bushveld',
  existing_firearm_1_make: 'Howa',
  existing_firearm_1_calibre: '.223 Remington',
  existing_firearm_1_primary_use: 'small_game',
  association_name: 'SA Hunters',
};

function build() {
  const calls: LlmRequest[] = [];
  const llm = {
    isConfigured: () => true,
    complete: async (req: LlmRequest) => {
      calls.push(req);
      return {
        text: Array.from({ length: 160 }, (_, i) => `word${i}`).join(' '),
        parts: [{ type: 'text', text: 'ok' }],
        toolCalls: [],
        stopReason: 'end',
        usage: { inputTokens: 50, outputTokens: 100 },
        model: 'gemini',
        provider: 'gemini',
        assistantMessage: { role: 'assistant', content: 'ok' },
      };
    },
  } as unknown as LlmService;
  const legal = {
    search: async () => [
      {
        id: 'p1',
        sourceSlug: 'firearms-act',
        sourceTitle: 'Firearms Control Act',
        documentType: 'ACT',
        citation: 's 16',
        sectionNumber: '16',
        heading: 'Dedicated hunter',
        chapter: null,
        part: null,
        snippet: 'A dedicated hunter <mark>may</mark> hold.',
        rank: 1,
      },
    ],
  } as unknown as LegalService;
  return { svc: new MotivationCaseResearchService(llm, legal), calls };
}

describe('the per-application case researcher', () => {
  it('sends the applicant’s exact calibre, quarry, battery and legal extract', async () => {
    const { svc, calls } = build();
    const entry = await svc.brief(
      MotivationLicenceType.S16_DEDICATED_HUNTER,
      ANSWERS,
      'hunting',
      'THE CARTRIDGE APPLIED FOR:\n.30-06 is a medium-game round.',
    );

    expect(entry?.target).toBe('case');
    expect(entry?.payload).toContain('word0');
    expect(entry?.sources[0].uri).toBe('legal://firearms-act/16');
    const prompt = String(calls[0].messages[0].content);
    expect(prompt).toContain('.30-06 Springfield');
    expect(prompt).toContain('Kudu');
    expect(prompt).toContain('.223 Remington');
    expect(prompt).toContain('A dedicated hunter may hold.');
    expect(prompt).toContain('MISSING FACTS');
  });

  it('does not send a case brief when the model is not configured', async () => {
    const llm = { isConfigured: () => false } as unknown as LlmService;
    const svc = new MotivationCaseResearchService(llm);
    await expect(
      svc.brief(MotivationLicenceType.S13_SELF_DEFENCE, {}, 'self-defence', ''),
    ).resolves.toBeNull();
  });
});
