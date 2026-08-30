import type { Dictionary, Level, VocabEntry } from "../dictionary/types";
import { LEVELS } from "../dictionary/types";
import { AhoCorasick } from "./aho-corasick";
import { analyzeSuffix, applySuffix, type SuffixRule } from "./affixes";
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
  /**
   * Set when the match came from stripping an affix off the input token. The
   * dictionary matched `stem` only; `translation` already includes the
   * re-attached Javanese affix.
   */
  affix?: {
    /** Indonesian suffix removed from the input, e.g. "nya" */
    suffix: string;
    /** the bare Indonesian stem that was looked up */
    stem: string;
  };
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
  /**
   * Single-word Indonesian patterns -> entries sharing that meaning. Used to
   * verify an affix-stripped stem is a real dictionary word before accepting
   * the split, and to translate it without re-running the automaton.
   */
  private reverseStems = new Map<string, VocabEntry[]>();

  constructor(dict: Dictionary) {
    for (const p of dict.patterns) {
      const tokens = p.pattern.split(" ");
      this.ac.add(tokens, { entry: p.entry, level: p.level });
    }
    this.ac.build();

    for (const p of dict.reversePatterns ?? []) {
      const tokens = p.pattern.split(" ");
      this.reverseAc.add(tokens, { entry: p.entry });

      // Affix stripping only ever produces a single-word stem.
      if (tokens.length === 1) {
        const bucket = this.reverseStems.get(p.pattern);
        if (bucket) bucket.push(p.entry);
        else this.reverseStems.set(p.pattern, [p.entry]);
      }
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
    const covered = new Set<number>();
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
      for (let i = m.start; i <= m.end; i++) covered.add(i);
      consumedUntil = m.end;
    }

    // Second pass: tokens the dictionary could not match as-is may still be an
    // inflected form ("agamanya"). Strip the affix, translate the bare stem,
    // then re-attach the Javanese affix for this level.
    for (let i = 0; i < tokens.length; i++) {
      if (covered.has(i)) continue;
      const tok = tokens[i]!;
      const affixMatch = this.matchWithAffix(tok, level);
      if (affixMatch) chosen.push(affixMatch);
    }

    // rebuild()/segment() walk matches left to right, so restore input order.
    chosen.sort((a, b) => a.start - b.start);

    return {
      input: text,
      output: this.rebuild(text, chosen),
      matches: chosen,
      tokens: this.segment(text, chosen),
    };
  }

  /**
   * Try to translate a single inflected token by splitting off a known affix.
   * Returns null when the token has no recognizable affix, when the leftover
   * stem is not in the dictionary, or when the affix has no form at `level`.
   */
  private matchWithAffix(tok: Token, level: Level): TranslationMatch | null {
    const analysis = analyzeSuffix(tok.norm, (stem) => this.reverseStems.has(stem));
    if (!analysis) return null;

    const entries = this.reverseStems.get(analysis.stem);
    if (!entries || entries.length === 0) return null;

    const { value: stemTranslation, level: resolvedLevel } = resolveLevel(
      entries[0]!.levels,
      level
    );
    if (stemTranslation === null) return null;

    const translation = applySuffix(stemTranslation, analysis.rule, resolvedLevel);
    // No suffix form in this register (e.g. krama has no bound "-ku").
    if (translation === null) return null;

    const meanings = javaneseSynonyms(entries, resolvedLevel, stemTranslation)
      .map((form) => applySuffix(form, analysis.rule, resolvedLevel))
      .filter((form): form is string => form !== null);

    return {
      source: tok.raw,
      translation,
      meanings,
      level: resolvedLevel,
      type: entries[0]!.type,
      vocabularyId: entries[0]!.vocabularyId,
      start: tok.start,
      end: tok.end,
      affix: { suffix: analysis.rule.suffix, stem: analysis.stem },
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
