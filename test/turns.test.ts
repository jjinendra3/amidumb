import { describe, expect, it } from 'vitest';
import { classifyPrompt, classifyTurns, isProposal } from '../src/signals/turns';
import { prompt, session } from './helpers';

describe('classifyPrompt', () => {
  it.each([
    ["TypeError: Cannot read properties of undefined (reading 'id')", 'error_paste'],
    ['fix it', 'retry'],
    ['still not working, please fix it again', 'retry'],
    ['still broken, the cart total is 0 when a coupon is applied', 'correct'],
    ["it's not working in src/cart/total.ts", 'correct'],
    ['no, use the cache instead', 'correct'],
    ['run the tests and show me the diff', 'verify'],
    ['why does useCart rerender twice?', 'question'],
    ['explain how the auth flow works', 'question'],
    ['can you add a logout button?', 'instruct'],
    ['add a logout button', 'instruct'],
    ["add a logout button to src/Header.tsx, don't touch the styles", 'specify'],
    ['rename it', 'instruct'],
  ] as const)('%j → %s', (text, cls) => expect(classifyPrompt(text, false)).toBe(cls));

  it('splits short approvals by context', () => {
    expect(classifyPrompt('yes', true)).toBe('approve');
    expect(classifyPrompt('yes', false)).toBe('nudge');
    expect(classifyPrompt('continue', true)).toBe('approve');
    expect(classifyPrompt('continue', false)).toBe('nudge');
    expect(classifyPrompt('pls do', true)).toBe('approve');
  });
});

describe('isProposal', () => {
  const none = new Set<string>();
  it.each([
    'Plan:\n1. a\n2. b',
    'Should I also update the tests?',
    'Done. If you want, I can also add a migration.',
    'Want me to open a PR?',
    'Which option do you prefer?',
  ])('proposal: %j', (text) => expect(isProposal(text, none)).toBe(true));

  it.each([
    'Done. Updated src/api/user.ts.',
    'I confirmed the tests pass.',
    'Progress: step 2 of 4 done.',
  ])('not a proposal: %j', (text) => expect(isProposal(text, none)).toBe(false));

  it('counts plan and question tools', () => {
    expect(isProposal(undefined, new Set(['ExitPlanMode']))).toBe(true);
    expect(isProposal('Done.', new Set(['AskUserQuestion']))).toBe(true);
    expect(isProposal('Done.', new Set(['Edit', 'Bash']))).toBe(false);
  });
});

describe('classifyTurns', () => {
  it('reads context from the agent turn before each prompt', () => {
    const turns = classifyTurns(
      session([
        prompt('ok'),
        { kind: 'assistant_text', text: 'Plan: do x. Should I proceed?' },
        { kind: 'tool_call', name: 'ExitPlanMode' },
        prompt('yes'),
        { kind: 'assistant_text', text: 'Done.' },
        prompt('ok'),
        { kind: 'tool_call', name: 'AskUserQuestion' },
        prompt('go'),
      ]),
    );
    expect(turns).toEqual([
      // The opening can't follow a proposal.
      { cls: 'nudge', afterProposal: false },
      { cls: 'approve', afterProposal: true },
      { cls: 'nudge', afterProposal: false },
      { cls: 'approve', afterProposal: true },
    ]);
  });
});

describe('rubric v2 classification', () => {
  it('never classes the opening prompt as a correction', () => {
    expect(classifyPrompt('use the cache instead of refetching in src/api.ts', false, true)).toBe(
      'specify',
    );
    expect(classifyPrompt('use the cache instead of refetching in src/api.ts', false)).toBe(
      'correct',
    );
  });

  it.each([
    'I meant the header, not the footer',
    'that is good but you missed the mobile layout',
    'make it a dropdown instead',
  ])('follow-up redirect %j → correct', (text) =>
    expect(classifyPrompt(text, false)).toBe('correct'),
  );

  it('classes a long marked prompt as a spec even when it ends with a question', () => {
    const spec = `In src/cart/total.ts the coupon discount is applied twice. Only touch computeTotal, keep the public types, and it should return 90 for the fixture. Can you look?`;
    expect(classifyPrompt(spec, false, true)).toBe('specify');
    expect(classifyPrompt('why does useCart rerender twice?', false)).toBe('question');
  });
});
