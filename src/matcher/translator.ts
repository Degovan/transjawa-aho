import type { Dictionary, Level, VocabEntry } from "../dictionary/types";
import { LEVELS } from "../dictionary/types";
import { AhoCorasick } from "./aho-corasick";
import { tokenize, type Token } from "./tokenizer";

/** "jv-id" (default): Javanese -> Indonesian. "id-jv": Indonesian -> Javanese. */
export type Direction = "jv-id" | "id-jv";

export interface TranslateOptions {
  direction?: Direction;
  /** Javanese level to render for "id-jv". Ignored for "jv-id". Defaults to "ngoko". */
  level?: Level;
}

export interface TranslationMatch {
  /** original surface text as it appeared in the input */
  source: string;
  /** chosen translation: primary Indonesian meaning ("jv-id"), or the
   * Javanese surface form for the resolved level ("id-jv") */
  translation: string;
  /**
   * Alternatives in the *output* language, `translation` first:
   * - "jv-id": all available Indonesian meanings for this entry.
   * - "id-jv": Javanese synonyms from other vocabulary entries sharing the
   *   matched Indonesian meaning, all rendered at `level` so the list never
   *   mixes registers.
   */
  meanings: string[];
  /**
   * For "jv-id": which Javanese level the matched surface form came from.
   * For "id-jv": which Javanese level `translation` was actually rendered in
   * (may differ from the requested level if that level is empty in the DB).
   */
  level: Level;
  type: string | null;
  vocabularyId: number;
  /** char offsets in the original input */
  start: number;
  end: number;
}

/**
 * A contiguous slice of the input. Concatenating every token's `text` in order
 * reproduces the original input exactly. `match` is set when the slice is a
 * translated Javanese word/phrase, so the frontend can render a dropdown for it
 * and plain text otherwise.
 */
export interface OutputToken {
  text: string;
  match: TranslationMatch | null;
}

export interface TranslateResult {
  input: string;
  /** input with matched Javanese words replaced by their primary meaning */
  output: string;
  matches: TranslationMatch[];
  /** full input split into ordered segments for rendering */
  tokens: OutputToken[];
}

/**
 * Resolve which Javanese level to render. If the requested level is empty in
 * the DB, fall back through ngoko -> krama -> inggil (in that priority) so we
 * never emit an empty string when at least one level is populated.
 */
function resolveLevel(
  levels: Record<Level, string>,
  requested: Level
): { value: string | null; level: Level } {
  if (levels[requested]) return { value: levels[requested], level: requested };
  for (const fallback of LEVELS) {
    if (levels[fallback]) return { value: levels[fallback], level: fallback };
  }
  return { value: null, level: requested };
}

/**
 * Javanese synonyms for one span, all rendered at the SAME level so the list
 * never mixes registers (e.g. never offers ngoko "aba" alongside krama
 * "titah"). Alternatives come from other vocabulary entries that share the
 * matched Indonesian meaning, not from the other levels of one entry.
 * `primary` stays first so it matches `translation`.
 */
function javaneseSynonyms(
  entries: VocabEntry[],
  level: Level,
  primary: string
): string[] {
  const seen = new Set<string>([primary]);
  const out = [primary];
  for (const entry of entries) {
    const form = entry.levels[level];
    if (!form || seen.has(form)) continue;
    seen.add(form);
    out.push(form);
  }
  return out;
}

export class Translator {
  private ac = new AhoCorasick<{ entry: VocabEntry; level: Level }>();
  private reverseAc = new AhoCorasick<{ entry: VocabEntry }>();

  constructor(dict: Dictionary) {
    for (const p of dict.patterns) {
      const tokens = p.pattern.split(" ");
      this.ac.add(tokens, { entry: p.entry, level: p.level });
    }
    this.ac.build();

    for (const p of dict.reversePatterns ?? []) {
      const tokens = p.pattern.split(" ");
      this.reverseAc.add(tokens, { entry: p.entry });
    }
    this.reverseAc.build();
  }

  translate(text: string, options: TranslateOptions = {}): TranslateResult {
    const direction = options.direction ?? "jv-id";
    return direction === "id-jv"
      ? this.translateIdToJv(text, options.level ?? "ngoko")
      : this.translateJvToId(text);
  }

  private translateJvToId(text: string): TranslateResult {
    const tokens = tokenize(text);
    const raw = this.ac.search(tokens.map((t) => t.norm));

    // Resolve overlaps: leftmost-longest wins. Sort by start asc, then length
    // desc, then greedily accept non-overlapping matches.
    raw.sort((a, b) => a.start - b.start || b.length - a.length);

    const chosen: TranslationMatch[] = [];
    let consumedUntil = -1;
    for (const m of raw) {
      if (m.start <= consumedUntil) continue;
      const startTok = tokens[m.start]!;
      const endTok = tokens[m.end]!;
      const meanings = m.payload.entry.meanings;
      chosen.push({
        source: text.slice(startTok.start, endTok.end),
        translation: meanings[0] ?? text.slice(startTok.start, endTok.end),
        meanings,
        level: m.payload.level,
        type: m.payload.entry.type,
        vocabularyId: m.payload.entry.vocabularyId,
        start: startTok.start,
        end: endTok.end,
      });
      consumedUntil = m.end;
    }

    return {
      input: text,
      output: this.rebuild(text, chosen),
      matches: chosen,
      tokens: this.segment(text, chosen),
    };
  }

  private translateIdToJv(text: string, level: Level): TranslateResult {
    const tokens = tokenize(text);
    const raw = this.reverseAc.search(tokens.map((t) => t.norm));

    raw.sort((a, b) => a.start - b.start || b.length - a.length);

    const chosen: TranslationMatch[] = [];
    let consumedUntil = -1;
    for (const m of raw) {
      if (m.start <= consumedUntil) continue;
      const startTok = tokens[m.start]!;
      const endTok = tokens[m.end]!;
      const source = text.slice(startTok.start, endTok.end);
      const { value: translation, level: resolvedLevel } = resolveLevel(
        m.payload.entry.levels,
        level
      );
      const finalTranslation = translation ?? source;

      // Other vocabulary entries matching this exact same span are synonyms.
      // Render them at `resolvedLevel` so the list stays in one register.
      const synonymEntries = raw
        .filter((o) => o.start === m.start && o.end === m.end)
        .map((o) => o.payload.entry);

      chosen.push({
        source,
        translation: finalTranslation,
        meanings:
          translation === null
            ? [finalTranslation]
            : javaneseSynonyms(synonymEntries, resolvedLevel, translation),
        level: resolvedLevel,
        type: m.payload.entry.type,
        vocabularyId: m.payload.entry.vocabularyId,
        start: startTok.start,
        end: endTok.end,
      });
      consumedUntil = m.end;
    }

    return {
      input: text,
      output: this.rebuild(text, chosen),
      matches: chosen,
      tokens: this.segment(text, chosen),
    };
  }

  /** Rebuild the string, replacing matched spans with their primary meaning. */
  private rebuild(text: string, matches: TranslationMatch[]): string {
    let out = "";
    let cursor = 0;
    for (const m of matches) {
      out += text.slice(cursor, m.start) + m.translation;
      cursor = m.end;
    }
    out += text.slice(cursor);
    return out;
  }

  /**
   * Split the full input into ordered segments. Concatenating every segment's
   * `text` reproduces the input exactly; matched spans carry their payload.
   */
  private segment(text: string, matches: TranslationMatch[]): OutputToken[] {
    const tokens: OutputToken[] = [];
    let cursor = 0;
    for (const m of matches) {
      if (m.start > cursor) {
        tokens.push({ text: text.slice(cursor, m.start), match: null });
      }
      tokens.push({ text: text.slice(m.start, m.end), match: m });
      cursor = m.end;
    }
    if (cursor < text.length) {
      tokens.push({ text: text.slice(cursor), match: null });
    }
    return tokens;
  }
}
