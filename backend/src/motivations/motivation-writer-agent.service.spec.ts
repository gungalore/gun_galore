import { MotivationLicenceType } from '@prisma/client';
import type { LlmService } from '../common/llm/llm.service';
import type { LlmRequest } from '../common/llm/llm.types';
import type { FactPack } from './motivation-prompts';
import { planFor } from './motivation-structure';
import { MotivationWriterAgentService } from './motivation-writer-agent.service';

const PACK = {
  licenceType: MotivationLicenceType.S16_DEDICATED_HUNTER,
  answers: {
    full_name: 'Johan Pretorius',
    firearm_make: 'Mauser',
    firearm_model: 'M96',
    firearm_calibre: '.30-06 Springfield',
    intended_quarry: 'Kudu',
    hunting_locations: 'Limpopo bushveld',
  },
  arsenal: [],
  intendedUses: [],
  derived: { years_dedicated: '3' },
  annexures: [],
} as unknown as FactPack;

function fakeLlm(): { llm: LlmService; calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  const llm = {
    model: 'gemini-3.8-flash',
    isConfigured: () => true,
    complete: async (req: LlmRequest) => {
      calls.push(req);
      return {
        text: `Body for section ${calls.length}.`,
        parts: [{ type: 'text', text: 'body' }],
        toolCalls: [],
        stopReason: 'end',
        usage: { inputTokens: 10, outputTokens: 5 },
        model: 'gemini-3.8-flash',
        provider: 'gemini',
        assistantMessage: { role: 'assistant', content: 'body' },
      };
    },
    stream: async function* () {},
  } as unknown as LlmService;
  return { llm, calls };
}

describe('the motivation writer agent', () => {
  const plan = planFor(
    MotivationLicenceType.S16_DEDICATED_HUNTER,
    7,
    {
      holdsFirearms: true,
      hasRecord: true,
      isAssociationMember: true,
      purpose: 'hunting',
    },
  );

  it('writes one call per section and joins the headings in order', async () => {
    const { llm, calls } = fakeLlm();
    const result = await new MotivationWriterAgentService(llm).generate(
      PACK,
      plan,
    );

    expect(calls).toHaveLength(plan.sections.length);
    for (const section of plan.sections) {
      expect(result.text).toContain(section.heading);
    }
    expect(result.text.indexOf(plan.sections[0].heading)).toBeLessThan(
      result.text.indexOf(plan.sections[1].heading),
    );
    expect(result.usage.promptTokens).toBe(plan.sections.length * 10);
    expect(result.usage.completionTokens).toBe(plan.sections.length * 5);
  });

  it('gives the statutory section the only quotable legal block', async () => {
    const { llm, calls } = fakeLlm();
    await new MotivationWriterAgentService(llm).generate(PACK, plan);

    const statutory = calls.find((c) =>
      String(c.messages[0].content).includes('statutory_application') ||
      String(c.messages[0].content).includes('THE STATUTORY TEXT'),
    );
    expect(statutory).toBeDefined();
    const statutoryCalls = calls.filter((c) =>
      String(c.messages[0].content).includes('<statutory-text>'),
    );
    expect(statutoryCalls).toHaveLength(1);
  });

  it('passes the previous headings so sections do not repeat each other', async () => {
    const { llm, calls } = fakeLlm();
    await new MotivationWriterAgentService(llm).generate(PACK, plan);

    const last = String(calls[calls.length - 1].messages[0].content);
    expect(last).toContain('ALREADY WRITTEN');
    expect(last).toContain(plan.sections[0].heading);
  });
});
