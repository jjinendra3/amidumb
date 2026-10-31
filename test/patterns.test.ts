import { describe, expect, it } from 'vitest';
import {
  hasAcceptance,
  hasConstraint,
  isApproval,
  isContinue,
  isCorrection,
  isErrorOnly,
  isFixIt,
  isObservation,
  isRage,
  isVerifyAsk,
  isVerifyCommand,
  looksPasted,
  namesPathOrSymbol,
  specMarkers,
} from '../src/signals/patterns';

const cases: Array<[string, (t: string) => boolean, string[], string[]]> = [
  [
    'namesPathOrSymbol',
    namesPathOrSymbol,
    [
      'update src/components/Cart.tsx',
      'look at config.yaml',
      'rename `getUser`',
      'the useCartStore hook is stale',
      'OrderCard renders twice',
      'set max_retries to 3',
      'call refresh() on mount',
    ],
    ['make it faster', 'fix the login bug please', 'see https://example.com/docs/page'],
  ],
  [
    'hasConstraint',
    hasConstraint,
    ["don't touch the tests", 'only change the API layer', 'must stay backwards compatible'],
    ['add a button', 'refactor the cart'],
  ],
  [
    'hasAcceptance',
    hasAcceptance,
    ['it should return 404 for missing ids', 'done when the tests pass'],
    ['add a button'],
  ],
  [
    'isFixIt',
    isFixIt,
    ['fix it', 'still not working', "it's not working", 'same error again', "didn't work"],
    ['fix the null check in parseOrder so empty carts return []', 'works now, thanks'],
  ],
  [
    'isContinue',
    isContinue,
    ['continue', 'go on', 'ok continue', 'keep going!'],
    ['continue with the migration but skip step 3'],
  ],
  [
    'isApproval',
    isApproval,
    ['yes', 'go ahead', 'lgtm, ship it', 'ok do it'],
    ['yes but rename the hook first and also update every caller in the cart package'],
  ],
  [
    'isCorrection',
    isCorrection,
    ['no, use the cache instead', 'wait, revert that', 'actually keep the old name'],
    ['now add tests', 'it is not the right file'],
  ],
  [
    'isVerifyAsk',
    isVerifyAsk,
    ['run the tests', 'show me the diff', 'did you test this?', 'review your change'],
    ['add a button'],
  ],
  [
    'isRage',
    isRage,
    ['wtf is this', 'WHY IS THIS STILL BROKEN', 'fix it!!!'],
    ['why is this still broken?', 'the API key is wrong'],
  ],
];

describe.each(cases)('%s', (_name, fn, positive, negative) => {
  it.each(positive)('matches %j', (t) => expect(fn(t)).toBe(true));
  it.each(negative)('ignores %j', (t) => expect(fn(t)).toBe(false));
});

describe('isErrorOnly', () => {
  it.each([
    "TypeError: Cannot read properties of undefined (reading 'id')",
    'Error: ENOENT: no such file or directory',
    'this again:\nTypeError: x is undefined\n    at render (src/App.tsx:12:5)',
    'src/App.tsx:12:5 - error TS2322: Type string is not assignable to type number',
  ])('matches %j', (t) => expect(isErrorOnly(t)).toBe(true));

  it.each([
    'fix this error',
    "I'm getting TypeError when clicking save, only on mobile, check the handler in Cart.tsx",
    'the build failed after my change to the router config, can you look at why the lazy route breaks',
  ])('ignores %j', (t) => expect(isErrorOnly(t)).toBe(false));
});

describe('looksPasted', () => {
  it('flags code fences, long multi-line text and logs', () => {
    expect(looksPasted('here:\n```ts\nconst a = 1;\n```')).toBe(true);
    expect(looksPasted(Array(20).fill('x'.repeat(50)).join('\n'))).toBe(true);
    expect(looksPasted('Error: a\nError: b\n    at f (a.ts:1:1)')).toBe(true);
    expect(looksPasted('add a button to the header')).toBe(false);
  });
});

describe('isVerifyCommand', () => {
  it.each([
    'pnpm test',
    'pnpm run typecheck',
    'npm run lint',
    'pnpm --filter web test',
    'npx vitest run src',
    'go test ./...',
    'cargo clippy',
    'tsc --noEmit',
    'await tools.exec_command({ cmd: "pnpm -w lint" })',
  ])('matches %j', (c) => expect(isVerifyCommand(c)).toBe(true));

  it.each(['ls src', 'git status', 'cat package.json', 'mkdir tests'])('ignores %j', (c) =>
    expect(isVerifyCommand(c)).toBe(false),
  );
});

describe('isObservation', () => {
  it.each([
    'I tested it locally, the modal still opens twice',
    'when I click save nothing happens',
    'it works now',
    'I get a 500 on the cart endpoint',
    'now the button shows but the list is empty',
    'checked on staging, looks right',
  ])('matches %j', (t) => expect(isObservation(t)).toBe(true));

  it.each([
    'make sure it works on mobile',
    'I get it, go ahead',
    'add a test for the coupon path',
    'it should work offline too',
  ])('ignores %j', (t) => expect(isObservation(t)).toBe(false));
});

describe('specMarkers', () => {
  it('counts where, constraint and done-criteria', () => {
    expect(specMarkers('add a logout button')).toBe(0);
    expect(specMarkers('add a logout button to src/Header.tsx')).toBe(1);
    expect(specMarkers("add a logout button to src/Header.tsx, don't touch styles")).toBe(2);
    expect(
      specMarkers("add logout to src/Header.tsx, don't touch styles, done when the e2e passes"),
    ).toBe(3);
  });
});
