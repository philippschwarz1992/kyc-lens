/** The 37 characters of a machine-readable zone (ICAO 9303), in classifier output order. */
export const MRZ_ALPHABET = '<0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export type MrzFormat = 'TD1' | 'TD2' | 'TD3';
export type MrzKind = 'passport' | 'id-card' | 'visa' | 'other';

/** What a machine-readable zone says about the document. It carries no personal data. */
export interface MrzSummary {
  format: MrzFormat;
  kind: MrzKind;
  /** Every check digit matches and the dates are real calendar dates. */
  valid: boolean;
}

/** Character classes allowed at one position. */
type Slot = 'alpha' | 'num' | 'alnum' | 'check' | 'check-or-filler' | 'sex';
interface CheckRule { digit: [line: number, position: number]; over: Array<[line: number, start: number, length: number]> }
interface Layout { lines: number; length: number; slots: Slot[][]; checks: CheckRule[]; dates: Array<[line: number, start: number]> }

function slots(length: number, ranges: Array<[start: number, end: number, slot: Slot]>): Slot[] {
  const line: Slot[] = new Array(length).fill('alnum');
  for (const [start, end, slot] of ranges) for (let i = start; i <= end; i++) line[i] = slot;
  return line;
}

export const MRZ_LAYOUTS: Record<MrzFormat, Layout> = {
  TD3: {
    lines: 2, length: 44,
    slots: [
      slots(44, [[0, 1, 'alpha'], [2, 4, 'alpha'], [5, 43, 'alpha']]),
      slots(44, [[0, 8, 'alnum'], [9, 9, 'check'], [10, 12, 'alpha'], [13, 18, 'num'], [19, 19, 'check'], [20, 20, 'sex'],
        [21, 26, 'num'], [27, 27, 'check'], [28, 41, 'alnum'], [42, 42, 'check-or-filler'], [43, 43, 'check']]),
    ],
    checks: [
      { digit: [1, 9], over: [[1, 0, 9]] }, { digit: [1, 19], over: [[1, 13, 6]] }, { digit: [1, 27], over: [[1, 21, 6]] },
      { digit: [1, 42], over: [[1, 28, 14]] },
      { digit: [1, 43], over: [[1, 0, 10], [1, 13, 7], [1, 21, 22]] },
    ],
    dates: [[1, 13], [1, 21]],
  },
  TD2: {
    lines: 2, length: 36,
    slots: [
      slots(36, [[0, 1, 'alpha'], [2, 4, 'alpha'], [5, 35, 'alpha']]),
      slots(36, [[0, 8, 'alnum'], [9, 9, 'check'], [10, 12, 'alpha'], [13, 18, 'num'], [19, 19, 'check'], [20, 20, 'sex'],
        [21, 26, 'num'], [27, 27, 'check'], [28, 34, 'alnum'], [35, 35, 'check']]),
    ],
    checks: [
      { digit: [1, 9], over: [[1, 0, 9]] }, { digit: [1, 19], over: [[1, 13, 6]] }, { digit: [1, 27], over: [[1, 21, 6]] },
      { digit: [1, 35], over: [[1, 0, 10], [1, 13, 7], [1, 21, 14]] },
    ],
    dates: [[1, 13], [1, 21]],
  },
  TD1: {
    lines: 3, length: 30,
    slots: [
      slots(30, [[0, 1, 'alpha'], [2, 4, 'alpha'], [5, 13, 'alnum'], [14, 14, 'check-or-filler'], [15, 29, 'alnum']]),
      slots(30, [[0, 5, 'num'], [6, 6, 'check'], [7, 7, 'sex'], [8, 13, 'num'], [14, 14, 'check'], [15, 17, 'alpha'],
        [18, 28, 'alnum'], [29, 29, 'check']]),
      slots(30, [[0, 29, 'alpha']]),
    ],
    checks: [
      { digit: [0, 14], over: [[0, 5, 9]] }, { digit: [1, 6], over: [[1, 0, 6]] }, { digit: [1, 14], over: [[1, 8, 6]] },
      { digit: [1, 29], over: [[0, 5, 25], [1, 0, 7], [1, 8, 7], [1, 18, 11]] },
    ],
    dates: [[1, 0], [1, 8]],
  },
};

const charValue = (char: string): number => char === '<' ? 0 : char >= '0' && char <= '9' ? char.charCodeAt(0) - 48 : char.charCodeAt(0) - 55;

/** ICAO 9303 check digit: weights 7, 3, 1 repeating, modulo 10. */
export function checkDigit(text: string): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum += charValue(text[i]!) * [7, 3, 1][i % 3]!;
  return sum % 10;
}

function allowed(slot: Slot, char: string): boolean {
  if (slot === 'alnum') return true;
  if (slot === 'alpha') return char === '<' || (char >= 'A' && char <= 'Z');
  if (slot === 'sex') return char === 'M' || char === 'F' || char === 'X' || char === '<';
  const digit = char >= '0' && char <= '9';
  return slot === 'num' || slot === 'check' ? digit : digit || char === '<';
}

function validDate(text: string): boolean {
  if (!/^\d{6}$/.test(text)) return false;
  const month = Number(text.slice(2, 4)), day = Number(text.slice(4, 6));
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/** The TD1 document number may continue into the optional field when it is longer than nine characters. */
function td1Number(line: string): string | null {
  if (line[14] !== '<') return null;
  const rest = line.slice(15).replace(/<+$/, '');
  return rest.length >= 1 ? line.slice(5, 14) + rest.slice(0, -1) : null;
}

function ruleHolds(lines: readonly string[], rule: CheckRule, format: MrzFormat): boolean {
  const [line, position] = rule.digit;
  const digit = lines[line]![position]!;
  const text = rule.over.map(([l, start, length]) => lines[l]!.slice(start, start + length)).join('');
  if (digit === '<') {
    // An empty optional field may carry a filler instead of a check digit; an extended TD1 number checks elsewhere.
    if (format === 'TD1' && line === 0 && position === 14) {
      const number = td1Number(lines[0]!), rest = lines[0]!.slice(15).replace(/<+$/, '');
      return number !== null && checkDigit(number) === charValue(rest[rest.length - 1]!);
    }
    return /^<*$/.test(text);
  }
  return digit >= '0' && digit <= '9' && checkDigit(text) === Number(digit);
}

/** Validates text lines that are already in a known layout. */
export function summarizeMrz(lines: readonly string[]): MrzSummary | null {
  const format = (Object.keys(MRZ_LAYOUTS) as MrzFormat[]).find(name =>
    MRZ_LAYOUTS[name].lines === lines.length && lines.every(line => line.length === MRZ_LAYOUTS[name].length));
  if (!format || lines.some(line => [...line].some(char => !MRZ_ALPHABET.includes(char)))) return null;
  const layout = MRZ_LAYOUTS[format];
  const valid = layout.checks.every(rule => ruleHolds(lines, rule, format))
    && layout.dates.every(([line, start]) => validDate(lines[line]!.slice(start, start + 6)));
  const code = lines[0]![0]!;
  // Format and document code agree for genuine layouts: passports are TD3, identity cards TD1 or TD2.
  const kind: MrzKind = code === 'P' && format === 'TD3' ? 'passport' : code === 'V' ? 'visa'
    : (code === 'I' || code === 'A' || code === 'C') && format !== 'TD3' ? 'id-card' : 'other';
  return { format, kind, valid };
}

/**
 * Turns per-character probabilities into the most likely MRZ text that satisfies the layout.
 * Each position keeps only the characters its field allows (so O/0 and I/1 confusions disappear),
 * and a failed check digit is repaired with the least confident alternatives before giving up.
 */
export function decodeMrz(format: MrzFormat, probabilities: ReadonlyArray<ReadonlyArray<ArrayLike<number>>>): { lines: string[]; summary: MrzSummary; confidence: number } | null {
  const layout = MRZ_LAYOUTS[format];
  if (probabilities.length !== layout.lines || probabilities.some(line => line.length !== layout.length)) return null;
  // Ranked candidates per position after the field constraint.
  const ranked = probabilities.map((line, l) => line.map((scores, p) => {
    const options: Array<{ char: string; score: number }> = [];
    for (let c = 0; c < MRZ_ALPHABET.length; c++) {
      const char = MRZ_ALPHABET[c]!;
      if (allowed(layout.slots[l]![p]!, char)) options.push({ char, score: Math.log(Math.max(1e-6, scores[c]!)) });
    }
    return options.sort((a, b) => b.score - a.score).slice(0, 3);
  }));
  const lines = ranked.map(line => line.map(options => options[0]!.char));
  const text = () => lines.map(line => line.join(''));
  for (const rule of layout.checks) {
    if (ruleHolds(text(), rule, format)) continue;
    // Positions this rule depends on, least confident first.
    const positions: Array<[number, number]> = [rule.digit];
    for (const [l, start, length] of rule.over) for (let p = start; p < start + length; p++) positions.push([l, p]);
    const margin = ([l, p]: [number, number]) => {
      const options = ranked[l]![p]!;
      return options.length > 1 ? options[0]!.score - options[1]!.score : Infinity;
    };
    const uncertain = positions.filter(position => margin(position) < Infinity).sort((a, b) => margin(a) - margin(b)).slice(0, 8);
    let best: { cost: number; changes: Array<[number, number, string]> } | null = null;
    const attempt = (changes: Array<[number, number, string]>, cost: number) => {
      if (best && cost >= best.cost) return;
      const saved = changes.map(([l, p]) => lines[l]![p]!);
      for (const [l, p, char] of changes) lines[l]![p] = char;
      if (ruleHolds(text(), rule, format)) best = { cost, changes };
      changes.forEach(([l, p], i) => { lines[l]![p] = saved[i]!; });
    };
    for (let i = 0; i < uncertain.length; i++) {
      const [li, pi] = uncertain[i]!;
      for (const option of ranked[li]![pi]!.slice(1)) {
        const costI = ranked[li]![pi]![0]!.score - option.score;
        attempt([[li, pi, option.char]], costI);
        for (let j = i + 1; j < uncertain.length; j++) {
          const [lj, pj] = uncertain[j]!;
          for (const second of ranked[lj]![pj]!.slice(1)) attempt([[li, pi, option.char], [lj, pj, second.char]], costI + ranked[lj]![pj]![0]!.score - second.score);
        }
      }
    }
    if (best) for (const [l, p, char] of (best as { changes: Array<[number, number, string]> }).changes) lines[l]![p] = char;
  }
  const result = text();
  const summary = summarizeMrz(result);
  if (!summary) return null;
  let confidence = 0;
  for (let l = 0; l < lines.length; l++) for (let p = 0; p < lines[l]!.length; p++) {
    const option = ranked[l]![p]!.find(candidate => candidate.char === lines[l]![p]);
    confidence += option ? Math.exp(option.score) : 0;
  }
  return { lines: result, summary, confidence: confidence / (layout.lines * layout.length) };
}
