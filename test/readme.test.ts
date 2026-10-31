import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ARCHETYPES } from '../src/score/archetypes';
import {
  MIN_PROMPTS,
  MIN_SESSIONS,
  RUBRIC_VERSION,
  SUB_SCORE_WEIGHTS,
  SUB_SCORES,
} from '../src/score/rubric';
import { TURN_CLASSES } from '../src/signals/turns';

// The README publishes the rubric. If the code changes and the README doesn't, people get
// scored by rules they can't read.

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const capitalize = (s: string) => s[0]?.toUpperCase() + s.slice(1);

describe('README rubric', () => {
  it('names the current rubric version', () => {
    expect(readme).toContain(`rubric v${RUBRIC_VERSION}`);
  });

  it.each(SUB_SCORES)('lists the %s weight', (id) => {
    expect(readme).toContain(`| ${capitalize(id)} | ${Math.round(SUB_SCORE_WEIGHTS[id] * 100)}% |`);
  });

  it.each(ARCHETYPES.map((a) => a.name))('lists the %s archetype', (name) => {
    expect(readme).toContain(name);
  });

  it.each(TURN_CLASSES)('explains the %s turn class', (cls) => {
    expect(readme).toContain(`| ${cls} |`);
  });

  it('states the minimum data', () => {
    expect(readme).toContain(`at least ${MIN_SESSIONS} sessions`);
    expect(readme).toContain(`${MIN_PROMPTS} prompts in total`);
  });
});
