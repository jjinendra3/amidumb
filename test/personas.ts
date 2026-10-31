import type { Leverage } from '../src/signals/leverage';
import { computeSessionSignals } from '../src/signals/session';
import type { Session, SessionEvent } from '../src/sources';

// Synthetic users at the extremes everyone agrees on. They pin the rubric: whatever the
// thresholds become, these must keep landing in their bands.

const you = (text: string): SessionEvent => ({
  kind: 'prompt',
  text,
  rawLength: text.length,
  hasPaste: false,
  images: 0,
});
const agent = (text: string): SessionEvent => ({ kind: 'assistant_text', text });
const tool = (name: string, command?: string): SessionEvent => ({
  kind: 'tool_call',
  name,
  command,
});
const edit = tool('Edit');
const runTests = tool('Bash', 'pnpm test');
const interrupt: SessionEvent = { kind: 'interrupt', duringTool: true };

const STACK =
  "TypeError: Cannot read properties of undefined (reading 'items')\n    at CartTotal (src/cart/CartTotal.tsx:14:22)\n    at renderWithHooks (react-dom.development.js:14985:18)";

function sessions(count: number, build: (i: number) => SessionEvent[]): Session[] {
  return Array.from({ length: count }, (_, i) => ({
    tool: 'claude-code',
    id: `s${i}`,
    origin: 'interactive',
    client: 'cli',
    events: build(i),
  }));
}

const noSetup: Leverage = {
  claudeGlobalInstructions: false,
  codexGlobalInstructions: false,
  claudeSkills: 0,
  claudeCommands: 0,
  claudeHooks: false,
  projectsWithInstructions: 0,
  projectsChecked: 2,
  projectsMissing: 0,
};
const someSetup: Leverage = {
  ...noSetup,
  claudeGlobalInstructions: true,
  projectsWithInstructions: 1,
};
const fullSetup: Leverage = {
  ...noSetup,
  claudeGlobalInstructions: true,
  claudeSkills: 5,
  claudeHooks: true,
  projectsWithInstructions: 2,
};

export interface Persona {
  name: string;
  sessions: Session[];
  leverage: Leverage;
}

export const PERSONAS = {
  errorPaster: {
    name: 'pastes errors and says "fix it"',
    leverage: noSetup,
    sessions: sessions(6, () => [
      you(STACK),
      agent('I added a null check.'),
      edit,
      you(STACK),
      agent('Updated the component.'),
      edit,
      you('still not working'),
      agent('Fixed.'),
      you(`${STACK}\n    at commitRoot (react-dom.development.js:26120:5)`),
      agent('Done.'),
      you('fix it'),
      agent('Done.'),
      you(STACK),
    ]),
  },
  slotMachine: {
    name: 'vague asks, "continue" and "fix it" on loop',
    leverage: noSetup,
    sessions: sessions(6, () => [
      you('make the app work'),
      agent('I created the page.'),
      edit,
      you('continue'),
      agent('Added more components.'),
      edit,
      you('continue'),
      agent('Progress: step 2 done.'),
      you('continue'),
      agent('All done.'),
      you('fix it'),
      agent('Fixed.'),
      you('still broken'),
      agent('Updated.'),
      you('try again'),
    ]),
  },
  architect: {
    name: 'specs with files and constraints, approves plans',
    leverage: someSetup,
    sessions: sessions(6, () => [
      you(
        'Add a retry to fetchUser in src/api/user.ts. Only retry on 5xx, max 3 attempts, keep the existing signature. Done when the existing tests pass.',
      ),
      agent('Plan:\n1. Wrap the fetch in a retry loop\n2. Back off 200ms\nShould I proceed?'),
      tool('ExitPlanMode'),
      you('yes'),
      agent('Done. Updated src/api/user.ts.'),
      edit,
      you("Also handle the timeout case in `fetchUser`, and don't change the public types."),
      agent('Handled. Want me to add tests?'),
      you('go ahead'),
      agent('Added tests; all passing.'),
      edit,
      runTests,
      you('Rename the helper to `withRetry` and move it to src/lib/retry.ts'),
      agent('Moved.'),
      edit,
    ]),
  },
  staffEngineer: {
    name: 'architect who also verifies and corrects with detail',
    leverage: fullSetup,
    sessions: sessions(6, () => [
      you(
        'Add a retry to fetchUser in src/api/user.ts. Only retry on 5xx, max 3 attempts, keep the existing signature.',
      ),
      agent('Plan:\n1. Wrap the fetch\n2. Add backoff\nShould I proceed?'),
      tool('ExitPlanMode'),
      you('yes'),
      agent('Done. I changed the signature to accept options.'),
      edit,
      you('no, keep the old signature and add an overload in src/api/user.ts instead'),
      agent('Reverted and added an overload.'),
      edit,
      you('run the tests and show me the diff'),
      agent('Tests pass. Diff below.'),
      runTests,
      you('Move the backoff constant to `src/lib/retry.ts` and export it, nothing else.'),
      agent('Moved.'),
      edit,
      you('Add a test for the 503 path in src/api/user.test.ts, it should retry exactly 3 times.'),
      agent('Added.'),
      edit,
      runTests,
    ]),
  },
  backseatDriver: {
    name: 'interrupts and redirects constantly',
    leverage: someSetup,
    sessions: sessions(6, () => [
      you('Refactor the cart reducer in src/cart/reducer.ts to use immer.'),
      agent('Starting with the reducer.'),
      edit,
      interrupt,
      you('no, not that file, start with src/cart/actions.ts'),
      edit,
      interrupt,
      you('stop, use the existing produce helper from src/lib/immer.ts'),
      edit,
      interrupt,
      you('wait, revert that last change'),
      agent('Reverted.'),
      edit,
      interrupt,
      you('actually keep the old action names'),
    ]),
  },
  mixed: {
    name: 'a normal mix: some specs, some nudges, one retry',
    leverage: someSetup,
    sessions: sessions(6, (i) => [
      you('add a dark mode toggle to the settings page'),
      agent('Added the toggle.'),
      edit,
      you('make it persist across reloads'),
      agent('Done.'),
      edit,
      you('use the existing useTheme hook, only change ThemeProvider.tsx'),
      agent('Updated. Want me to add tests?'),
      you('ok'),
      agent('Added.'),
      edit,
      ...(i % 2 === 0 ? [runTests] : []),
      you('fix it'),
      agent('Fixed the failing snapshot.'),
      you('continue'),
    ]),
  },
} satisfies Record<string, Persona>;

export function rowsOf(persona: Persona) {
  return persona.sessions.map(computeSessionSignals);
}
