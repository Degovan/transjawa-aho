import type { Level } from "../dictionary/types";
import { LEVELS } from "../dictionary/types";

/**
 * Affix rules for Indonesian -> Javanese.
 *
 * The Aho-Corasick dictionary only holds base words, so an inflected input like
 * "agamanya" never matches as a whole. These rules split the affix off, let the
 * automaton translate the bare stem ("agama"), and then re-attach the Javanese
 * equivalent of the affix at the requested level.
 *
 * Everything here is data. To teach the service a new affix, add a rule to
 * `SUFFIX_RULES` — no changes needed in the matcher.
 *
 * Why not Sastrawi (sastrawijs)?
 * - Its `stem()` only returns the root, discarding *which* affix was removed.
 *   We need that identity to pick the Javanese replacement.
 * - It stems against the Kateglo base-word list, while our own vocabulary table
 *   is the source of truth here. Stripping is therefore dictionary-guided: an
 *   affix is only removed when the leftover stem actually exists in our
 *   dictionary, which rules out nonsense splits like "raya" -> "ra" + "ya".
 */

/**
 * Javanese realization of an affix. Javanese possessive/definite suffixes have
 * allomorphs driven by the final sound of the stem they attach to:
 *
 *   sega  + ne    -> segane     (vowel-final)
 *   omah  + e     -> omahe      (consonant-final)
 *   sekul + ipun  -> sekulipun  (consonant-final, krama)
 *
 * so each level declares both forms.
 *
 * A form may contain a space, which turns one input token into a multi-word
 * result. Krama has no bound 1st-person possessive, so "agamaku" becomes
 * "agaminipun kula": the noun takes the definite suffix and the pronoun follows
 * as a free word. Since attachment is plain concatenation, no special handling
 * is needed — write the space into the form.
 */
export interface JavaneseAffix {
  afterVowel: string;
  afterConsonant: string;
}

export interface SuffixRule {
  /** Indonesian suffix exactly as written in the input, without a dash. */
  suffix: string;
  /**
   * Javanese replacement per level. A level may be omitted when the affix has
   * no sensible realization in that register; the token is then left
   * untranslated rather than guessed.
   */
  javanese: Partial<Record<Level, JavaneseAffix>>;
  /**
   * Minimum length of the leftover stem. A secondary guard only; the real
   * guard is that the stem must exist in the dictionary.
   */
  minStemLength: number;
}

/**
 * Ordered longest-suffix-first at module load, so "-nya" is tried before a
 * hypothetical "-a" and the greediest valid split wins.
 */
export const SUFFIX_RULES: SuffixRule[] = [
  {
    // Possessive 3rd person / definite marker: "agamanya" -> "agama" + nya.
    suffix: "nya",
    javanese: {
      ngoko: { afterVowel: "ne", afterConsonant: "e" },
      krama: { afterVowel: "nipun", afterConsonant: "ipun" },
      inggil: { afterVowel: "nipun", afterConsonant: "ipun" },
    },
    minStemLength: 2,
  },
  {
    // Possessive 1st person: "agamaku" -> "agama" + ku.
    //   ngoko  -> bound suffix:            agama + ku          = agamaku
    //   krama  -> definite + free pronoun: agami + nipun kula  = agaminipun kula
    // Krama has no bound 1st-person suffix, so it marks the noun as definite
    // (-nipun / -ipun) and adds the free pronoun "kula" as a separate word.
    suffix: "ku",
    javanese: {
      ngoko: { afterVowel: "ku", afterConsonant: "ku" },
      krama: { afterVowel: "nipun kula", afterConsonant: "ipun kula" },
      inggil: { afterVowel: "nipun kula", afterConsonant: "ipun kula" },
    },
    minStemLength: 2,
  },
  {
    // Possessive 2nd person: "agamamu" -> "agama" + mu.
    // Same shape as "-ku", but the 2nd-person pronoun differs by register:
    //   ngoko  -> bound suffix:  agama + mu                 = agamamu
    //   krama  -> "sampeyan":    agami + nipun sampeyan     = agaminipun sampeyan
    //   inggil -> "panjenengan": agami + nipun panjenengan  = agaminipun panjenengan
    // "panjenengan" outranks "sampeyan" in deference, so it belongs to inggil.
    suffix: "mu",
    javanese: {
      ngoko: { afterVowel: "mu", afterConsonant: "mu" },
      krama: { afterVowel: "nipun sampeyan", afterConsonant: "ipun sampeyan" },
      inggil: { afterVowel: "nipun panjenengan", afterConsonant: "ipun panjenengan" },
    },
    minStemLength: 2,
  },
].sort((a, b) => b.suffix.length - a.suffix.length);

export interface SuffixAnalysis {
  /** The bare stem to hand to the automaton. */
  stem: string;
  rule: SuffixRule;
}

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

/**
 * One Javanese affix form, flattened for the jv -> id direction.
 *
 * Going Javanese -> Indonesian is not a mirror of the other direction: the
 * caller does not say which level the input is in, so the level has to be
 * inferred from the affix form itself. "agamane" implies ngoko, "agaminipun
 * kula" implies krama. These entries are derived from SUFFIX_RULES so the rule
 * table stays the single source of truth.
 */
interface JavaneseAffixForm {
  /** the Javanese affix as it appears in input, e.g. "ne" or "nipun kula" */
  form: string;
  /** how many whitespace-separated words the form spans (1 or more) */
  wordCount: number;
  /** Indonesian suffix to restore, e.g. "nya" */
  indonesianSuffix: string;
  /** level this form reveals about the input */
  level: Level;
}

/**
 * Every Javanese affix form, longest first so "nipun kula" is tried before
 * "nipun" and the greediest valid split wins.
 */
const JAVANESE_AFFIX_FORMS: JavaneseAffixForm[] = SUFFIX_RULES.flatMap((rule) =>
  LEVELS.flatMap((level) => {
    const affix = rule.javanese[level];
    if (!affix) return [];
    // afterVowel/afterConsonant often differ only by a leading "n"; both are
    // valid input forms, so index each distinct one.
    return [...new Set([affix.afterVowel, affix.afterConsonant])].map((form) => ({
      form,
      wordCount: form.trim().split(/\s+/).length,
      indonesianSuffix: rule.suffix,
      level,
    }));
  })
).sort((a, b) => b.form.length - a.form.length);

/**
 * How many words beyond the affixed token the longest affix form can reach.
 * "nipun kula" spans two words, so it needs one word of lookahead. Derived from
 * the rules so callers never have to hardcode it — and so the jv -> id pass can
 * bound its lookahead instead of slicing the rest of the input per token.
 */
export const MAX_AFFIX_LOOKAHEAD = Math.max(
  0,
  ...JAVANESE_AFFIX_FORMS.map((f) => f.wordCount - 1)
);

export interface JavaneseSuffixAnalysis {
  /** bare Javanese stem to look up in the dictionary */
  stem: string;
  /** Indonesian suffix to append to the translated stem */
  indonesianSuffix: string;
  /** level inferred from the affix form */
  level: Level;
  /** Javanese affix that was stripped */
  javaneseAffix: string;
  /**
   * How many input tokens the whole match covers. 1 for a bound suffix like
   * "-ne"; 2 for "…nipun kula" where the pronoun is a separate word.
   */
  tokenSpan: number;
}

/**
 * Strip a Javanese affix off `token`, optionally consuming following words when
 * the affix form is multi-word ("nipun kula"). `nextWords` supplies the
 * normalized tokens after `token`; `isKnownStem` confirms the leftover stem is
 * a real dictionary entry.
 *
 * Returns null when nothing matches.
 */
export function analyzeJavaneseSuffix(
  token: string,
  nextWords: string[],
  isKnownStem: (stem: string) => boolean
): JavaneseSuffixAnalysis | null {
  for (const entry of JAVANESE_AFFIX_FORMS) {
    const words = entry.form.trim().split(/\s+/);
    const bound = words[0]!;

    // The first word carries the bound part; the rest must match what follows.
    if (!token.endsWith(bound)) continue;
    const trailing = words.slice(1);
    if (trailing.length > nextWords.length) continue;
    if (trailing.some((w, i) => nextWords[i] !== w)) continue;

    const stem = token.slice(0, token.length - bound.length);
    if (stem.length < 2) continue;
    if (!isKnownStem(stem)) continue;

    return {
      stem,
      indonesianSuffix: entry.indonesianSuffix,
      level: entry.level,
      javaneseAffix: entry.form,
      tokenSpan: 1 + trailing.length,
    };
  }
  return null;
}

/**
 * Split one token into stem + suffix, but only when `isKnownStem` confirms the
 * leftover stem is a real dictionary entry. Longest suffix wins. Returns null
 * when the token carries no recognizable affix.
 */
export function analyzeSuffix(
  token: string,
  isKnownStem: (stem: string) => boolean
): SuffixAnalysis | null {
  for (const rule of SUFFIX_RULES) {
    if (!token.endsWith(rule.suffix)) continue;
    const stem = token.slice(0, token.length - rule.suffix.length);
    if (stem.length < rule.minStemLength) continue;
    if (!isKnownStem(stem)) continue;
    return { stem, rule };
  }
  return null;
}

/**
 * Attach the Javanese affix to an already-translated Javanese stem, choosing
 * the allomorph from that stem's final letter. Returns null when the rule has
 * no form for this level, signalling the caller to leave the token alone.
 */
export function applySuffix(
  javaneseStem: string,
  rule: SuffixRule,
  level: Level
): string | null {
  const affix = rule.javanese[level];
  if (!affix) return null;
  const lastChar = javaneseStem.slice(-1).toLowerCase();
  const form = VOWELS.has(lastChar) ? affix.afterVowel : affix.afterConsonant;
  return javaneseStem + form;
}
