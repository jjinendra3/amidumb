// Raw prompt classifiers. Each answers one narrow question about a prompt's text, without
// context. Judging a prompt against the turn before it ("yes" after a plan vs. "fix it"
// after a failure) is a separate step built on top of these.

const URL = /\bhttps?:\/\/\S+/g;
const FILE_PATH = /(?:^|[\s(`'"@])(?:~|\.{1,2})?\/?[\w@.-]+\/[\w@.-]+/;
const FILE_NAME =
  /\b[\w-]+\.(?:tsx?|jsx?|mjs|cjs|go|py|rs|java|kt|swift|rb|php|cs|cpp|cc|c|h|json|ya?ml|toml|md|css|scss|html|sql|sh|proto|graphql|env)\b/;
const BACKTICK_CODE = /`[^`\n]{2,80}`/;
const CAMEL_CASE = /\b[a-z]+[A-Z][A-Za-z0-9]*\b/;
const PASCAL_CASE = /\b[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*\b/;
const SNAKE_CASE = /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/;
const CALL = /\b[A-Za-z_]\w*\(\)/;

/** Names a file, path or code symbol. */
export function namesPathOrSymbol(text: string): boolean {
  const t = text.replace(URL, ' ');
  return [FILE_PATH, FILE_NAME, BACKTICK_CODE, CAMEL_CASE, PASCAL_CASE, SNAKE_CASE, CALL].some(
    (re) => re.test(t),
  );
}

const CONSTRAINT =
  /\b(only|don'?t|do not|must|never|without|avoid|instead of|rather than|make sure|ensure|exactly|at most|no more than|should ?n[o']t|keep (it|the|this|them|existing))\b/i;

/** Sets a boundary on what the agent may do. */
export function hasConstraint(text: string): boolean {
  return CONSTRAINT.test(text);
}

const ACCEPTANCE =
  /\b(should (return|show|render|display|be|have|throw|fail|pass)|expected|acceptance|so that|done when|until (it|they|the tests?) pass|it works when|success means)\b/i;

/** States what "done" looks like. */
export function hasAcceptance(text: string): boolean {
  return ACCEPTANCE.test(text);
}

/**
 * How many of the three things a spec pins down this prompt has: where (a path or
 * symbol), a constraint, and done-criteria. 2+ reads as a spec, 1 as a clear goal.
 */
export function specMarkers(text: string): number {
  return [namesPathOrSymbol(text), hasConstraint(text), hasAcceptance(text)].filter(Boolean).length;
}

/** Log-shaped lines: `Error:` prefixes, *Error/*Exception names, stack frames, tool codes. */
const ERROR_LINE =
  /(\b([Ee]rror|ERROR|[Ww]arning|WARN|[Ff]atal|FATAL|panic)(\[[\w-]+\])?:|\b[A-Z][a-zA-Z]+(Error|Exception)\b|\bTraceback\b|^\s+at\s+\S+|\bERR_[A-Z_]+|\berror TS\d+|npm ERR!|exit code \d+|\bFAIL(ED)?\b|\S+\.\w+:\d+:\d+)/;
/** A one-line prompt counts as an error paste only when it starts with the error. */
const ERROR_START =
  /^\s*(([A-Z][a-zA-Z]+)?(Error|Exception)\b|([Ee]rror|ERROR|[Ff]atal|FATAL|panic)\b|Traceback|npm ERR!|ERR_|FAIL|\S+\.\w+:\d+:\d+)/;

/** Mostly a pasted error or log with almost no words from the user. */
export function isErrorOnly(text: string): boolean {
  const lines = text.split('\n').filter((l) => l.trim());
  const [first] = lines;
  if (first === undefined) return false;
  if (lines.length === 1) return ERROR_LINE.test(first) && ERROR_START.test(first);
  let errorLines = 0;
  let prose = 0;
  for (const line of lines) {
    if (ERROR_LINE.test(line)) errorLines++;
    else prose += line.trim().length;
  }
  return errorLines > 0 && prose < 40;
}

/** Looks pasted: long and multi-line, a code fence, or a log/stack trace. */
export function looksPasted(text: string): boolean {
  if (text.includes('```')) return true;
  const lines = text.split('\n');
  if (lines.length >= 15 && text.length >= 800) return true;
  return lines.filter((l) => ERROR_LINE.test(l)).length >= 3;
}

const FIX_IT =
  /\b(fix (it|this|that|these|the (error|issue|bug))|still (not working|broken|failing|fails|doesn'?t work|the same|getting|happening|there)|(it'?s|is|its) not working|does ?n[o']t work|did ?n[o']t work|not fixed|same (error|issue|problem|thing)|try again|doesn'?t fix)\b/i;

/** "fix it", "still broken" and friends. */
export function isFixIt(text: string): boolean {
  return FIX_IT.test(text);
}

const FIX_IT_ALL = new RegExp(FIX_IT.source, 'gi');
const FILLER =
  /\b(please|pls|plz|again|now|still|just|it|this|that|the|same|ok|okay|so|and|but|bro|man|dude|yo|ugh|lol|can you|could you)\b/gi;

/**
 * What a fix-it prompt says beyond "fix it": the text with fix-it phrases, filler words
 * and punctuation removed. Empty-ish means the user added no new information.
 */
export function fixItRemainder(text: string): string {
  return text
    .replace(FIX_IT_ALL, ' ')
    .replace(FILLER, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const QUESTION_START =
  /^(why|what|how|where|which|who|when|does|is|are|was|were|explain|(can|could|would) you (explain|tell|clarify|walk me|help me understand))\b/i;
/** "can you add X?" is a request, not a question. */
const REQUEST_START = /^(can|could|would|will) you\b|^(please|pls)\b/i;

/** Asks for information rather than for work. */
export function isQuestion(text: string): boolean {
  const t = text.trim();
  if (QUESTION_START.test(t)) return true;
  return t.endsWith('?') && !REQUEST_START.test(t);
}

const CONTINUE =
  /^(please |pls |ok,? |okay,? )?(continue|go on|keep going|carry on|resume|next|more|and\??)[\s.!]*(please|pls)?[\s.!]*$/i;

/** A bare "continue". */
export function isContinue(text: string): boolean {
  return CONTINUE.test(text.trim());
}

const APPROVAL =
  /^(yes|yep|yeah|yup|y|ok|okay|sure|go|go ahead|go for it|do it|do that|pls do|please do|lgtm|looks good|sounds good|approved?|ship it|proceed|perfect|great|nice|cool)\b[\s\S]{0,40}$/i;

/** A short approval. Good after a plan, empty on a loop; context decides which. */
export function isApproval(text: string): boolean {
  return APPROVAL.test(text.trim());
}

const CORRECTION =
  /^(no\b|nope|nah|wrong|that'?s (wrong|not)|not (that|this|what)|wait\b|stop\b|actually\b|instead\b|undo|revert)/i;

/** Redirects that can sit anywhere in a follow-up, not just at the start. */
const REDIRECT =
  /\b(instead|rather than|i meant|i said|not what i (asked|meant|wanted|said)|that'?s not (it|right|what)|you (missed|forgot|broke|ignored|skipped)|wrong (file|place|approach|one))\b/i;

/** Pushes back on what the agent just did. Only meaningful after the agent has acted. */
export function isCorrection(text: string): boolean {
  return CORRECTION.test(text.trim()) || REDIRECT.test(text);
}

/** Wishes about the result ("make sure it works") are not reports of it. */
const DESIRE =
  /\b(make sure|ensure|so that|until|should|must|check (that|if|whether))\b[^.\n]{0,30}/gi;
const OBSERVATION =
  /\b(i (tested|checked|tried|ran|verified|confirmed)\b|i (see|saw|get|got|noticed) (the|an?|this|that|no|nothing|\d)|tested (it|this|that|locally|on)|works (now|fine|locally|for me|on)|(is|it'?s|its) working|on my (end|machine)|in the browser|on (staging|prod|production|preprod)|when i (run|click|open|load|try|go)|now (it|the \w+) (shows|works|renders|fails|breaks|crashes|returns|throws)|(it|that|this) (works|worked)( now| fine)?[.!]*\s*$)/im;

/** Reports what the human saw when they ran or used the result: they checked it. */
export function isObservation(text: string): boolean {
  return OBSERVATION.test(text.replace(DESIRE, ' '));
}

const VERIFY_ASK =
  /\b(review|show (me )?the diff|git diff|double[- ]check|verify|did you (test|run|check)|run (the )?(tests?|typecheck|lint|build)|add (a )?tests?|write (a )?tests?|prove)\b/i;

/** Asks the agent to check, test or show its work. */
export function isVerifyAsk(text: string): boolean {
  return VERIFY_ASK.test(text);
}

const RAGE_WORDS =
  /\b(wtf|wth|ffs|omfg|fuck\w*|shit\w*|damn|stupid|dumb|idiot\w*|useless|garbage)\b/i;

/** Swearing, shouting or a wall of exclamation marks. */
export function isRage(text: string): boolean {
  if (RAGE_WORDS.test(text) || /[!?]{3,}/.test(text)) return true;
  const letters = text.replace(/[^A-Za-z]/g, '');
  return letters.length >= 12 && letters.replace(/[^A-Z]/g, '').length / letters.length >= 0.8;
}

const VERIFY_COMMAND =
  /\b((npm|pnpm|yarn|bun|npx|pnpx|bunx)\s+(run\s+)?(-w\s+|--filter\s+\S+\s+)?(test|typecheck|type-check|lint|check|tsc|vitest|jest|playwright)|vitest|jest|pytest|mocha|playwright test|cypress run|tsc\b|eslint|biome (check|lint|ci)|ruff|mypy|golangci-lint|go (test|vet)|cargo (test|clippy|check)|make (test|check|lint)|gradlew? test|mvn test|rspec)\b/;

/** A shell command that runs tests, a typecheck or a linter. */
export function isVerifyCommand(command: string): boolean {
  return VERIFY_COMMAND.test(command);
}
