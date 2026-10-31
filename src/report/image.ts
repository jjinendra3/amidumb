import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { maskForCard } from '../judge/mask';
import { SUB_SCORES } from '../score/rubric';
import type { CardInput } from './card';

// The shareable PNG. Layout is a satori element tree (flexbox, real font metrics), then
// resvg rasterises it. Both load lazily, so --json and the debug views never pay for them.

export const IMAGE_WIDTH = 1080;
export const IMAGE_HEIGHT = 1350;
const PAD = 72;
const RAGE_CELLS = 10;
const RAGE_FULL_SHARE = 0.05;

const INK = '#f5f5f7';
const MUTED = '#9b9ba7';
const TRACK = 'rgba(255,255,255,0.10)';
const RAGE = '#ff5c5c';

interface Element {
  type: string;
  props: { style?: Record<string, unknown>; children?: unknown };
}

const el = (style: Record<string, unknown>, children?: unknown): Element => ({
  type: 'div',
  props: { style: { display: 'flex', ...style }, children },
});

function tone(score: number): { accent: string; glow: string } {
  if (score >= 70) return { accent: '#4ade80', glow: '#0f3d26' };
  if (score >= 40) return { accent: '#fbbf24', glow: '#3d2e0a' };
  return { accent: '#f87171', glow: '#3d1414' };
}

/** Only characters the bundled fonts can draw: no emoji, no control characters. */
export function printable(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}|\u{FE0F}|\u{200D}/gu, '')
    .replace(/[\p{Cc}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const clean = (text: string) => printable(maskForCard(text));

export function cardElement(input: CardInput): Element {
  const { score, verdict, window } = input;
  const { accent, glow } = tone(score.overall);
  const rageShare = window.prompts ? input.ragePrompts / window.prompts : 0;
  const rageCells = Math.round(Math.min(1, rageShare / RAGE_FULL_SHARE) * RAGE_CELLS);

  const header = el({ justifyContent: 'space-between', alignItems: 'center' }, [
    el({ fontSize: 28, fontWeight: 900, color: INK, letterSpacing: -0.5 }, 'amidumb'),
    el({ fontSize: 20, color: MUTED }, 'your AI coding transcripts, judged'),
  ]);

  const hero = el({ flexDirection: 'column' }, [
    el({ alignItems: 'flex-end' }, [
      el(
        { fontSize: 176, fontWeight: 900, color: accent, lineHeight: 0.9, letterSpacing: -7 },
        String(score.overall),
      ),
      el({ fontSize: 40, fontWeight: 700, color: MUTED, marginLeft: 10, marginBottom: 12 }, '/100'),
    ]),
    el(
      {
        fontSize: 58,
        fontWeight: 900,
        color: INK,
        letterSpacing: -2,
        marginTop: 10,
        lineHeight: 1,
      },
      score.archetype.name.toUpperCase(),
    ),
  ]);

  const headline = verdict
    ? el(
        { fontSize: 33, fontWeight: 700, color: INK, lineHeight: 1.22 },
        `“${clean(verdict.verdict)}”`,
      )
    : undefined;

  const bars = el(
    { flexDirection: 'column', gap: 10 },
    SUB_SCORES.map((id) => {
      const sub = score.subScores[id];
      return el({ alignItems: 'center' }, [
        el({ width: 220, fontSize: 22, color: MUTED }, id),
        el({ flexGrow: 1, height: 16, borderRadius: 8, backgroundColor: TRACK }, [
          el({
            width: `${sub?.score ?? 0}%`,
            height: 16,
            borderRadius: 8,
            backgroundColor: accent,
          }),
        ]),
        el(
          { width: 68, justifyContent: 'flex-end', fontSize: 24, fontWeight: 700, color: INK },
          sub ? String(sub.score) : '–',
        ),
      ]);
    }),
  );

  const why = verdict
    ? el({ flexDirection: 'column', gap: 12 }, [
        el({ fontSize: 19, fontWeight: 700, color: accent, letterSpacing: 4 }, 'WHY THIS SCORE'),
        ...verdict.points.map((point) =>
          el({ alignItems: 'flex-start' }, [
            // A drawn dot: the bundled font subset has no arrows.
            el({ width: 30, height: 32, alignItems: 'center' }, [
              el({ width: 10, height: 10, borderRadius: 5, backgroundColor: accent }),
            ]),
            el({ flex: 1, fontSize: 24, color: INK, lineHeight: 1.33 }, clean(point)),
          ]),
        ),
      ])
    : undefined;

  const stats = el({ flexDirection: 'column', gap: 10 }, [
    el({ alignItems: 'center' }, [
      el({ width: 220, fontSize: 22, color: MUTED }, 'rage meter'),
      el(
        { gap: 6 },
        Array.from({ length: RAGE_CELLS }, (_, i) =>
          el({
            width: 22,
            height: 22,
            borderRadius: 4,
            backgroundColor: i < rageCells ? RAGE : TRACK,
          }),
        ),
      ),
      el(
        { marginLeft: 18, fontSize: 22, color: INK },
        input.ragePrompts ? `${input.ragePrompts} unhinged prompts` : 'zen. suspiciously zen.',
      ),
    ]),
    el({ alignItems: 'center' }, [
      el({ width: 220, fontSize: 22, color: MUTED }, 'secrets leaked'),
      el(
        { fontSize: 22, color: INK },
        input.secrets
          ? `${input.secrets} pasted into prompts (we redacted them)`
          : 'none. respect.',
      ),
    ]),
  ]);

  const footer = el({ justifyContent: 'space-between', alignItems: 'center' }, [
    el({ fontSize: 19, color: MUTED }, `${window.sessions} sessions · ${window.prompts} prompts`),
    el({ fontSize: 24, fontWeight: 900, color: accent }, 'npx amidumb'),
  ]);

  // An explicit content box: satori adds padding on top of percentage sizes.
  const content = el(
    {
      width: IMAGE_WIDTH - 2 * PAD,
      height: IMAGE_HEIGHT - 2 * PAD,
      flexDirection: 'column',
      justifyContent: 'space-between',
      overflow: 'hidden',
    },
    [header, hero, headline, bars, why, stats, footer].filter(Boolean),
  );
  return el(
    {
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Inter',
      color: INK,
      backgroundColor: '#0b0b10',
      backgroundImage: `radial-gradient(circle at 85% 8%, ${glow} 0%, #0b0b10 55%)`,
    },
    [content],
  );
}

function fontsDir(): string {
  // dist/cli.js in the package, src/report/image.ts in development.
  for (const rel of ['../assets/fonts/', '../../assets/fonts/']) {
    const url = new URL(rel, import.meta.url);
    if (existsSync(url)) return fileURLToPath(url);
  }
  throw new Error('bundled fonts not found');
}

export async function renderCardPng(input: CardInput): Promise<Buffer> {
  const [{ default: satori }, resvg] = await Promise.all([
    import('satori'),
    import('@resvg/resvg-js'),
  ]);
  const dir = fontsDir();
  const font = (weight: 400 | 700 | 900) => ({
    name: 'Inter',
    data: readFileSync(`${dir}inter-${weight}.woff`),
    weight,
    style: 'normal' as const,
  });
  const svg = await satori(cardElement(input), {
    width: IMAGE_WIDTH,
    height: IMAGE_HEIGHT,
    fonts: [font(400), font(700), font(900)],
  });
  const Resvg = resvg.Resvg ?? resvg.default.Resvg;
  return new Resvg(svg, { fitTo: { mode: 'width', value: IMAGE_WIDTH } }).render().asPng();
}
