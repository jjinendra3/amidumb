import { SUB_SCORES, type UserScore } from '../score/rubric';

const BAR_WIDTH = 20;

function bar(score: number): string {
  const filled = Math.round((score / 100) * BAR_WIDTH);
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
}

export interface WindowInfo {
  days: number | 'all';
  sessions: number;
  prompts: number;
}

export function describeWindow(w: WindowInfo): string {
  const span = w.days === 'all' ? 'all history' : `last ${w.days} ${w.days === 1 ? 'day' : 'days'}`;
  return `${span}, ${w.sessions} sessions, ${w.prompts} prompts`;
}

export function renderScore(score: UserScore, window: WindowInfo): string {
  const lines = [
    `amidumb · rubric v${score.rubricVersion} · ${describeWindow(window)}`,
    '',
    `  ${score.overall} / 100   ${score.archetype.name}`,
    '',
  ];
  for (const id of SUB_SCORES) {
    const sub = score.subScores[id];
    lines.push(
      sub
        ? `  ${id.padEnd(13)} ${String(sub.score).padStart(3)}  ${bar(sub.score)}  ${sub.reason}`
        : `  ${id.padEnd(13)}   –  ${'·'.repeat(BAR_WIDTH)}  not enough data`,
    );
  }
  return lines.join('\n');
}
