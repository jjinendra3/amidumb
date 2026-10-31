// Agents and IDE extensions prepend context to what the human typed. Strip it so prompt
// metrics measure the human's words, not the tool's.

/** Tag blocks injected by IDE extensions or the agent itself. */
const INJECTED_TAGS =
  /<(ide_[a-z_]+|system-reminder|environment_context|user_instructions)>[\s\S]*?<\/\1>/g;

type SectionKind = 'keep' | 'drop' | 'paste';

/**
 * Markdown section headings the Codex IDE and desktop apps wrap prompts in. Text under a
 * `drop` heading is injected context; `keep` sections are written or chosen by the user
 * (annotations, @-mentioned files, the request itself); `paste` sections are pasted files.
 */
const SECTIONS: ReadonlyArray<readonly [RegExp, SectionKind]> = [
  [/^# Context from my IDE setup:\s*$/, 'drop'],
  [/^# In app browser:\s*$/, 'drop'],
  [/^# Files pasted by the user:\s*$/, 'paste'],
  [/^# Files mentioned by the user:\s*$/, 'keep'],
  [/^# (Response annotations|Diff comments|Browser comments):\s*$/, 'keep'],
  [/^## My request(?: for Codex)?:\s*$/, 'keep'],
];

export interface StrippedPrompt {
  text: string;
  hasPaste: boolean;
  /** The raw text was non-empty but held only injected context. */
  contextOnly: boolean;
}

export function stripInjected(raw: string): StrippedPrompt {
  const withoutTags = raw.replace(INJECTED_TAGS, '');
  const kept: string[] = [];
  let section: SectionKind = 'keep';
  let hasPaste = false;

  for (const line of withoutTags.split('\n')) {
    const heading = SECTIONS.find(([re]) => re.test(line));
    if (heading) {
      section = heading[1];
      continue;
    }
    if (section === 'keep') kept.push(line);
    else if (section === 'paste' && line.trim()) hasPaste = true;
  }

  const text = kept.join('\n').trim();
  return { text, hasPaste, contextOnly: text === '' && raw.trim() !== '' };
}
