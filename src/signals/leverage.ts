import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Setup that makes an agent better before the first prompt. Counts and booleans only. */
export interface Leverage {
  claudeGlobalInstructions: boolean;
  codexGlobalInstructions: boolean;
  claudeSkills: number;
  claudeCommands: number;
  claudeHooks: boolean;
  codexSkills: number;
  /** Custom prompts, Codex's older take on commands. */
  codexPrompts: number;
  codexHooks: boolean;
  /** Distinct session working directories with a CLAUDE.md or AGENTS.md. */
  projectsWithInstructions: number;
  projectsChecked: number;
  /** Working directories that no longer exist on disk. */
  projectsMissing: number;
}

const PROJECT_INSTRUCTION_FILES = ['CLAUDE.md', 'AGENTS.md', join('.claude', 'CLAUDE.md')];

export function readLeverage(
  cwds: Iterable<string>,
  env: NodeJS.ProcessEnv = process.env,
): Leverage {
  const claudeHome = env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  const codexHome = env.CODEX_HOME ?? join(homedir(), '.codex');

  let projectsWithInstructions = 0;
  let projectsChecked = 0;
  let projectsMissing = 0;
  for (const cwd of new Set(cwds)) {
    if (!existsSync(cwd)) {
      projectsMissing++;
      continue;
    }
    projectsChecked++;
    if (PROJECT_INSTRUCTION_FILES.some((f) => existsSync(join(cwd, f)))) projectsWithInstructions++;
  }

  return {
    claudeGlobalInstructions: existsSync(join(claudeHome, 'CLAUDE.md')),
    codexGlobalInstructions: existsSync(join(codexHome, 'AGENTS.md')),
    claudeSkills: countEntries(join(claudeHome, 'skills')),
    claudeCommands: countEntries(join(claudeHome, 'commands')),
    claudeHooks: hasHooks(join(claudeHome, 'settings.json')),
    codexSkills: countEntries(join(codexHome, 'skills')),
    codexPrompts: countEntries(join(codexHome, 'prompts')),
    codexHooks:
      hasHooks(join(codexHome, 'hooks.json')) || hasHookTable(join(codexHome, 'config.toml')),
    projectsWithInstructions,
    projectsChecked,
    projectsMissing,
  };
}

function countEntries(dir: string): number {
  try {
    return readdirSync(dir).filter((name) => !name.startsWith('.')).length;
  } catch {
    return 0;
  }
}

/** Codex can also declare hooks as `[hooks...]` tables in config.toml. */
function hasHookTable(configFile: string): boolean {
  try {
    return /^\s*\[\[?hooks[.\]]/m.test(readFileSync(configFile, 'utf8'));
  } catch {
    return false;
  }
}

function hasHooks(settingsFile: string): boolean {
  try {
    const settings: unknown = JSON.parse(readFileSync(settingsFile, 'utf8'));
    if (typeof settings !== 'object' || settings === null || !('hooks' in settings)) return false;
    const { hooks } = settings;
    return typeof hooks === 'object' && hooks !== null && Object.keys(hooks).length > 0;
  } catch {
    return false;
  }
}
