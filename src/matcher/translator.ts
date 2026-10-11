import type { Dictionary, Level, VocabEntry } from "../dictionary/types";
import { LEVELS } from "../dictionary/types";
import { AhoCorasick } from "./aho-corasick";
import {
  analyzeJavaneseSuffix,
  analyzeSuffix,
  applySuffix,
  MAX_AFFIX_LOOKAHEAD,
  type SuffixRule,
} from "./affixes";
import {
  analyzePrefix,
  applyPrefix,
  INDONESIAN_PREFIX_FORMS,
  INDONESIAN_PREFIX_REVERSALS,
  JAVANESE_PREFIX_FORMS,
  JAVANESE_PREFIX_REVERSALS,
} from "./prefixes";
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
  /**
   * Set when the match came from stripping a verbal prefix (Indonesian `meN-`,
   * Javanese `ater-ater anuswara`). The dictionary matched `stem` only;
   * `translation` already carries the re-applied prefix.
   */
  prefix?: {
    /** surface prefix removed from the input, e.g. "men" or "n" */
    prefix: string;
    /** the bare stem that was looked up in the dictionary */
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

/** A dictionary phrase whose final word can carry an affix. */
interface StemCandidate {
  /** the phrase's words, e.g. ["anak", "kedua"] */
  words: string[];
  entries: VocabEntry[];
}

/**
 * Lookup for affix stripping, keyed by a phrase's LAST word.
 *
 * An affix always attaches to the final word of a phrase ("anak kedua" +
 * "-ku" -> "anak keduaku"), so after stripping the suffix off a token we need
 * every phrase ending in the leftover stem — not just the single-word entries.
 * Keying by last word keeps that lookup O(1); candidates then only need their
 * leading words compared against the tokens before the match.
 *
 * Candidates are held longest-phrase-first so the greediest match wins,
 * mirroring the leftmost-longest rule used by the automaton.
 */
class StemIndex {
  private byLastWord = new Map<string, StemCandidate[]>();
  /** Single-word patterns only, for prefix reconstruction. */
  private singleWord = new Map<string, VocabEntry[]>();
  /** Which level a single-word Javanese pattern came from. */
  private singleWordLevel = new Map<string, Level>();

  add(words: string[], entry: VocabEntry, level?: Level): void {
    if (words.length === 0) return;

    if (words.length === 1) {
      const word = words[0]!;
      const single = this.singleWord.get(word);
      if (single) single.push(entry);
      else this.singleWord.set(word, [entry]);
      // Keep the first level seen; patterns are added ngoko-first.
      if (level && !this.singleWordLevel.has(word)) {
        this.singleWordLevel.set(word, level);
      }
    }

    const key = words[words.length - 1]!;
    const bucket = this.byLastWord.get(key);
    if (!bucket) {
      this.byLastWord.set(key, [{ words, entries: [entry] }]);
      return;
    }
    // Merge into the existing candidate when the exact same phrase repeats.
    const same = bucket.find(
      (c) => c.words.length === words.length && c.words.every((w, i) => words[i] === w)
    );
    if (same) same.entries.push(entry);
    else {
      bucket.push({ words, entries: [entry] });
      bucket.sort((a, b) => b.words.length - a.words.length);
    }
  }

  /** True when at least one phrase ends with `stem`. */
  has(stem: string): boolean {
    return this.byLastWord.has(stem);
  }

  /** Every phrase ending with `stem`, longest first. */
  candidates(stem: string): StemCandidate[] {
    return this.byLastWord.get(stem) ?? [];
  }

  /** True when `stem` exists as a standalone single-word pattern. */
  hasExact(stem: string): boolean {
    return this.singleWord.has(stem);
  }

  /** Entries whose pattern is exactly the single word `stem`. */
  exact(stem: string): VocabEntry[] {
    return this.singleWord.get(stem) ?? [];
  }

  /** Level the single-word pattern `stem` was registered under. */
  levelOf(stem: string): Level | undefined {
    return this.singleWordLevel.get(stem);
  }
}

export class Translator {
  private ac = new AhoCorasick<{ entry: VocabEntry; level: Level }>();
  private reverseAc = new AhoCorasick<{ entry: VocabEntry }>();
  /**
   * Single-word Indonesian patterns -> entries sharing that meaning. Used to
   * verify an affix-stripped stem is a real dictionary word before accepting
   * the split, and to translate it without re-running the automaton.
   */
  private reverseStems = new StemIndex();
  /**
   * Mirror of `reverseStems` for the jv -> id direction, used to verify an
   * affix-stripped Javanese stem is a real dictionary word.
   */
  private forwardStems = new StemIndex();

  constructor(dict: Dictionary) {
    for (const p of dict.patterns) {
      const tokens = p.pattern.split(" ");
      this.ac.add(tokens, { entry: p.entry, level: p.level });
      this.forwardStems.add(tokens, p.entry, p.level);
    }
    this.ac.build();

    for (const p of dict.reversePatterns ?? []) {
      const tokens = p.pattern.split(" ");
      this.reverseAc.add(tokens, { entry: p.entry });
      this.reverseStems.add(tokens, p.entry);
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
    const covered = new Set<number>();
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
      for (let i = m.start; i <= m.end; i++) covered.add(i);
      consumedUntil = m.end;
    }

    // Second pass, mirroring translateIdToJv: an unmatched token may be an
    // inflected Javanese form ("agamane"). Strip the affix, translate the bare
    // stem, then restore the Indonesian suffix.
    for (let i = 0; i < tokens.length; i++) {
      if (covered.has(i)) continue;
      const match = this.matchJavaneseWithAffix(text, tokens, i, covered);
      if (match) chosen.push(match);
    }

    // Third pass: verbal prefixes ("nulis" -> "tulis"). Last, so dictionary
    // entries and suffix forms always take precedence.
    for (let i = 0; i < tokens.length; i++) {
      if (covered.has(i)) continue;
      const prefixMatch = this.matchJvPrefix(tokens[i]!);
      if (prefixMatch) {
        chosen.push(prefixMatch);
        covered.add(i);
      }
    }

    chosen.sort((a, b) => a.start - b.start);

    return {
      input: text,
      output: this.rebuild(text, chosen),
      matches: chosen,
      tokens: this.segment(text, chosen),
    };
  }

  /**
   * Try to translate an inflected Javanese token at `index` by splitting off a
   * known affix. May consume following tokens when the Javanese affix is
   * multi-word ("agaminipun kula"), marking them covered so they are not
   * revisited.
   */
  private matchJavaneseWithAffix(
    text: string,
    tokens: Token[],
    index: number,
    covered: Set<number>
  ): TranslationMatch | null {
    const tok = tokens[index]!;
    // Only look ahead as far as the longest affix form actually needs. Slicing
    // the whole remainder here would make the pass O(n^2) on long inputs.
    const nextWords: string[] = [];
    const lookahead = Math.min(index + 1 + MAX_AFFIX_LOOKAHEAD, tokens.length);
    for (let i = index + 1; i < lookahead; i++) nextWords.push(tokens[i]!.norm);

    const analysis = analyzeJavaneseSuffix(tok.norm, nextWords, (stem) =>
      this.forwardStems.has(stem)
    );
    if (!analysis) return null;

    // Bail out if the multi-word affix form would swallow an already-matched
    // token, or run past the end of the input.
    for (let i = index; i < index + analysis.tokenSpan; i++) {
      if (i >= tokens.length) return null;
      if (i !== index && covered.has(i)) return null;
    }

    // The stem may be the tail of a phrase ("anak keduane"), so match the words
    // before it as well.
    const phrase = this.resolvePhrase(
      this.forwardStems.candidates(analysis.stem),
      tokens,
      index,
      covered
    );
    if (!phrase) return null;

    const meanings = phrase.entries[0]!.meanings;
    if (meanings.length === 0) return null;

    const startTok = tokens[phrase.startIndex]!;
    const endTok = tokens[index + analysis.tokenSpan - 1]!;
    const suffix = analysis.indonesianSuffix;

    for (let i = phrase.startIndex; i < index + analysis.tokenSpan; i++) covered.add(i);

    return {
      // slice from the original text so inner spacing is preserved verbatim
      source: text.slice(startTok.start, endTok.end),
      translation: meanings[0]! + suffix,
      meanings: meanings.map((m) => m + suffix),
      level: analysis.level,
      type: phrase.entries[0]!.type,
      vocabularyId: phrase.entries[0]!.vocabularyId,
      start: startTok.start,
      end: endTok.end,
      affix: { suffix: analysis.javaneseAffix, stem: phrase.words.join(" ") },
    };
  }

  private translateIdToJv(text: string, level: Level): TranslateResult {
    const tokens = tokenize(text);
    const raw = this.reverseAc.search(tokens.map((t) => t.norm));

    raw.sort((a, b) => a.start - b.start || b.length - a.length);

    // Group entries by span up front. Scanning `raw` inside the loop instead
    // would be O(matches x raw), which gets expensive on synonym-heavy input.
    const bySpan = new Map<string, VocabEntry[]>();
    for (const m of raw) {
      const key = `${m.start}:${m.end}`;
      const bucket = bySpan.get(key);
      if (bucket) bucket.push(m.payload.entry);
      else bySpan.set(key, [m.payload.entry]);
    }

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

      // Entries matching this exact same span are synonyms. Render them at
      // `resolvedLevel` so the list stays in one register.
      const synonymEntries = bySpan.get(`${m.start}:${m.end}`)!;

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
      const affixMatch = this.matchWithAffix(text, tokens, i, covered, level);
      if (affixMatch) chosen.push(affixMatch);
    }

    // Third pass: still unmatched tokens may carry a verbal prefix
    // ("menulis" -> "tulis"). Runs last so dictionary entries and suffix forms
    // always win over prefix reconstruction.
    for (let i = 0; i < tokens.length; i++) {
      if (covered.has(i)) continue;
      const prefixMatch = this.matchIdPrefix(tokens[i]!, level);
      if (prefixMatch) {
        chosen.push(prefixMatch);
        covered.add(i);
      }
    }

    chosen.sort((a, b) => a.start - b.start);

    return {
      input: text,
      output: this.rebuild(text, chosen),
      matches: chosen,
      tokens: this.segment(text, chosen),
    };
  }

  /**
   * Try to translate an inflected token at `index` by splitting off a known
   * affix. The stripped stem may be the tail of a multi-word phrase ("anak
   * keduaku" -> "anak kedua" + "-ku"), so preceding tokens are matched too.
   *
   * Returns null when the token has no recognizable affix, when no dictionary
   * phrase ends with the leftover stem, or when the affix has no form at
   * `level`.
   */
  private matchWithAffix(
    text: string,
    tokens: Token[],
    index: number,
    covered: Set<number>,
    level: Level
  ): TranslationMatch | null {
    const tok = tokens[index]!;
    const analysis = analyzeSuffix(tok.norm, (stem) => this.reverseStems.has(stem));
    if (!analysis) return null;

    const phrase = this.resolvePhrase(
      this.reverseStems.candidates(analysis.stem),
      tokens,
      index,
      covered
    );
    if (!phrase) return null;

    const { value: stemTranslation, level: resolvedLevel } = resolveLevel(
      phrase.entries[0]!.levels,
      level
    );
    if (stemTranslation === null) return null;

    const translation = applySuffix(stemTranslation, analysis.rule, resolvedLevel);
    // No suffix form in this register (e.g. a rule with no krama entry).
    if (translation === null) return null;

    const meanings = javaneseSynonyms(phrase.entries, resolvedLevel, stemTranslation)
      .map((form) => applySuffix(form, analysis.rule, resolvedLevel))
      .filter((form): form is string => form !== null);

    for (let i = phrase.startIndex; i <= index; i++) covered.add(i);

    const startTok = tokens[phrase.startIndex]!;
    return {
      source: text.slice(startTok.start, tok.end),
      translation,
      meanings,
      level: resolvedLevel,
      type: phrase.entries[0]!.type,
      vocabularyId: phrase.entries[0]!.vocabularyId,
      start: startTok.start,
      end: tok.end,
      affix: { suffix: analysis.rule.suffix, stem: phrase.words.join(" ") },
    };
  }

  /**
   * id -> jv: translate a prefixed Indonesian verb by reconstructing its stem
   * ("menulis" -> "tulis"), translating that, then applying the Javanese
   * `ater-ater` to the result ("tulis" -> "nulis").
   *
   * Only single-word stems are considered: a verbal prefix attaches to one
   * word, not to the head of a phrase.
   */
  private matchIdPrefix(tok: Token, level: Level): TranslationMatch | null {
    const analysis = analyzePrefix(tok.norm, INDONESIAN_PREFIX_REVERSALS, (stem) =>
      this.reverseStems.hasExact(stem)
    );
    if (!analysis) return null;

    const entries = this.reverseStems.exact(analysis.stem);
    if (entries.length === 0) return null;

    const { value: stemTranslation, level: resolvedLevel } = resolveLevel(
      entries[0]!.levels,
      level
    );
    if (stemTranslation === null) return null;

    // `ater-ater` is register-neutral, so the same nasal prefix applies at
    // every level; the level only decides which stem column we started from.
    const translation = applyPrefix(stemTranslation, JAVANESE_PREFIX_FORMS);
    if (translation === null) return null;

    const meanings = javaneseSynonyms(entries, resolvedLevel, stemTranslation)
      .map((form) => applyPrefix(form, JAVANESE_PREFIX_FORMS))
      .filter((form): form is string => form !== null);

    return {
      source: tok.raw,
      translation,
      meanings: meanings.length > 0 ? meanings : [translation],
      level: resolvedLevel,
      type: entries[0]!.type,
      vocabularyId: entries[0]!.vocabularyId,
      start: tok.start,
      end: tok.end,
      prefix: { prefix: analysis.prefix, stem: analysis.stem },
    };
  }

  /**
   * jv -> id: mirror of `matchIdPrefix`. Reconstructs the Javanese stem
   * ("nulis" -> "tulis"), translates it, then applies Indonesian `meN-`.
   */
  private matchJvPrefix(tok: Token): TranslationMatch | null {
    const analysis = analyzePrefix(tok.norm, JAVANESE_PREFIX_REVERSALS, (stem) =>
      this.forwardStems.hasExact(stem)
    );
    if (!analysis) return null;

    const entries = this.forwardStems.exact(analysis.stem);
    if (entries.length === 0) return null;

    const meanings = entries[0]!.meanings;
    if (meanings.length === 0) return null;

    const prefixed = meanings
      .map((m) => applyPrefix(m, INDONESIAN_PREFIX_FORMS))
      .filter((m): m is string => m !== null);
    if (prefixed.length === 0) return null;

    return {
      source: tok.raw,
      translation: prefixed[0]!,
      meanings: prefixed,
      // The stem's own level; ater-ater carries no register information.
      level: this.forwardStems.levelOf(analysis.stem) ?? "ngoko",
      type: entries[0]!.type,
      vocabularyId: entries[0]!.vocabularyId,
      start: tok.start,
      end: tok.end,
      prefix: { prefix: analysis.prefix, stem: analysis.stem },
    };
  }

  /**
   * Pick the longest candidate phrase whose leading words match the tokens
   * immediately before `endIndex`. Candidates arrive longest-first, so the
   * first fit wins. Tokens already consumed by another match disqualify a
   * candidate.
   */
  private resolvePhrase(
    candidates: StemCandidate[],
    tokens: Token[],
    endIndex: number,
    covered: Set<number>
  ): (StemCandidate & { startIndex: number }) | null {
    for (const candidate of candidates) {
      const leading = candidate.words.slice(0, -1);
      const startIndex = endIndex - leading.length;
      if (startIndex < 0) continue;

      let fits = true;
      for (let i = 0; i < leading.length; i++) {
        const at = startIndex + i;
        if (covered.has(at) || tokens[at]!.norm !== leading[i]) {
          fits = false;
          break;
        }
      }
      if (fits) return { ...candidate, startIndex };
    }
    return null;
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
