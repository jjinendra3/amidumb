import type { LabelFieldKey, SessionLabel } from '../label/fields';
import type { SessionScore } from '../score/rubric';

// Does the rubric rank your sessions the way your labels do? Agreement is the share of
// (better-labelled, worse-labelled) session pairs where the better one scores higher.
// 50% is a coin flip. Low agreement means the rubric needs work, not the labels.

type Metric = keyof Pick<SessionScore, 'opening' | 'steering' | 'verification'>;

interface Check {
  field: Exclude<LabelFieldKey, 'kind' | 'outcome'>;
  metric: Metric;
  /** Best tier first. Values not listed (e.g. n/a, exploration) are left out. */
  tiers: readonly (readonly string[])[];
}

export const CHECKS: readonly Check[] = [
  // The label describes the first prompt only, so compare it with the opening part of
  // Specification, not the whole-session sub-score.
  { field: 'opening', metric: 'opening', tiers: [['spec'], ['goal'], ['vague'], ['error']] },
  {
    field: 'steering',
    metric: 'steering',
    tiers: [
      ['redirected', 'not-needed'],
      ['retried', 'abandoned'],
    ],
  },
  {
    field: 'verification',
    metric: 'verification',
    tiers: [['checked'], ['agent-checked'], ['trusted']],
  },
];

/** Agreement needs this many scored sessions in at least two tiers. */
export const MIN_PER_TIER = 3;

export interface Calibration {
  field: Check['field'];
  metric: Metric;
  rows: { value: string; n: number; mean: number | undefined }[];
  agreement?: { share: number; pairs: number };
}

export function orderingAgreement(
  tiers: readonly (readonly number[])[],
): { share: number; pairs: number } | undefined {
  if (tiers.filter((t) => t.length >= MIN_PER_TIER).length < 2) return undefined;
  let wins = 0;
  let pairs = 0;
  for (let i = 0; i < tiers.length; i++) {
    for (let j = i + 1; j < tiers.length; j++) {
      for (const better of tiers[i] ?? []) {
        for (const worse of tiers[j] ?? []) {
          pairs++;
          wins += better > worse ? 1 : better === worse ? 0.5 : 0;
        }
      }
    }
  }
  return pairs ? { share: wins / pairs, pairs } : undefined;
}

export function calibrate(
  labels: Readonly<Record<string, SessionLabel>>,
  scores: ReadonlyMap<string, SessionScore>,
): Calibration[] {
  return CHECKS.map((check) => {
    const byValue = new Map<string, number[]>();
    for (const [id, label] of Object.entries(labels)) {
      const score = scores.get(id)?.[check.metric];
      if (score === undefined) continue;
      const value = label[check.field];
      byValue.set(value, [...(byValue.get(value) ?? []), score]);
    }
    const rows = check.tiers.flat().map((value) => {
      const values = byValue.get(value) ?? [];
      return {
        value,
        n: values.length,
        mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined,
      };
    });
    const tierScores = check.tiers.map((tier) => tier.flatMap((v) => byValue.get(v) ?? []));
    return {
      field: check.field,
      metric: check.metric,
      rows,
      agreement: orderingAgreement(tierScores),
    };
  });
}

export function renderCalibration(
  results: readonly Calibration[],
  labelled: number,
  matched: number,
): string {
  const lines = [`${labelled} labelled sessions, ${matched} found in your transcripts`, ''];
  for (const c of results) {
    lines.push(`${c.field} → ${c.metric}`);
    for (const r of c.rows) {
      lines.push(
        `  ${r.value.padEnd(14)} n=${String(r.n).padStart(3)}  avg ${r.mean === undefined ? '  –' : String(Math.round(r.mean)).padStart(3)}`,
      );
    }
    lines.push(
      c.agreement
        ? `  ordering agreement: ${Math.round(c.agreement.share * 100)}% over ${c.agreement.pairs} pairs`
        : `  ordering agreement: need ${MIN_PER_TIER}+ scored sessions in at least two groups`,
      '',
    );
  }
  return lines.join('\n');
}
