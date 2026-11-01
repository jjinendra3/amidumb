import { describe, expect, it } from 'vitest';
import { ARCHETYPES } from '../src/score/archetypes';
import { scoreUser } from '../src/score/rubric';
import { PERSONAS, type Persona, rowsOf } from './personas';

const score = (p: Persona) => {
  const s = scoreUser(rowsOf(p), p.leverage);
  if (!s) throw new Error(`${p.name}: not enough data to score`);
  return s;
};

describe('reference personas', () => {
  it('error paster scores under 30', () => {
    const s = score(PERSONAS.errorPaster);
    expect(s.overall).toBeLessThan(30);
  });

  it('slot-machine vibecoder scores under 35', () => {
    const s = score(PERSONAS.slotMachine);
    expect(s.overall).toBeLessThan(35);
  });

  it('architect scores over 75', () => {
    const s = score(PERSONAS.architect);
    expect(s.overall).toBeGreaterThan(75);
  });

  it('staff engineer scores over 80', () => {
    const s = score(PERSONAS.staffEngineer);
    expect(s.overall).toBeGreaterThan(80);
  });

  it('titles every persona by its 5-point score band alone', () => {
    const fromBottom = ARCHETYPES.map((a) => a.id).reverse();
    for (const p of Object.values(PERSONAS)) {
      const s = score(p);
      expect(s.archetype.id, p.name).toBe(fromBottom[Math.min(19, Math.floor(s.overall / 5))]);
    }
  });

  it('a normal mix lands in the middle', () => {
    const s = score(PERSONAS.mixed);
    expect(s.overall).toBeGreaterThanOrEqual(40);
    expect(s.overall).toBeLessThanOrEqual(70);
  });

  it('orders the extremes', () => {
    const [paster, slot, mixed, architect, staff] = [
      PERSONAS.errorPaster,
      PERSONAS.slotMachine,
      PERSONAS.mixed,
      PERSONAS.architect,
      PERSONAS.staffEngineer,
    ].map((p) => score(p).overall);
    expect(Math.max(paster ?? 0, slot ?? 0)).toBeLessThan(mixed ?? 0);
    expect(mixed).toBeLessThan(Math.min(architect ?? 0, staff ?? 0));
  });

  it('is deterministic', () => {
    expect(score(PERSONAS.mixed)).toEqual(score(PERSONAS.mixed));
  });
});
