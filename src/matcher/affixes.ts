import type { Level } from "../dictionary/types";

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
