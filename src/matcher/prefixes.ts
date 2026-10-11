import type { Level } from "../dictionary/types";

/**
 * Prefix rules for the Indonesian `meN-` / Javanese `ater-ater anuswara` pair.
 *
 * Kept apart from `affixes.ts` (suffixes) because prefixes need a fundamentally
 * different strategy. A suffix is removed by plain truncation: "agamane" minus
 * "ne" is unambiguously "agama". A prefix is not, because both languages DELETE
 * the stem's initial consonant when prefixing:
 *
 *   Indonesian: tulis  -> menulis   (t deleted)
 *               sikat  -> menyikat  (s deleted)
 *   Javanese:   tulis  -> nulis     (t deleted)
 *               pangan -> mangan    (p deleted)
 *               kuras  -> nguras    (k deleted)
 *
 * Reading "nulis" backwards, the stem could be "ulis" (nothing deleted) or
 * "tulis" (t restored) — the surface form alone cannot tell us. So instead of
 * truncating, we GENERATE every candidate stem the rules allow and let the
 * dictionary decide which one is real. That is the same guard the suffix pass
 * uses, just applied to a small candidate set instead of a single split.
 *
 * References:
 * - Chaer, Abdul. 2002. Morfologi Bahasa Indonesia. Jakarta: PT Rineka Cipta.
 *   (meN- has six allomorphs: me-, mem-, men-, meny-, meng-, menge-)
 * - Ater-ater anuswara (m-, n-, ny-, ng-) as taught in Javanese grammar:
 *   am + buru = mburu, an + tulis = nulis, any + cukil = nyukil,
 *   ang + kuras = nguras.
 */

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

function isVowel(ch: string): boolean {
  return VOWELS.has(ch.toLowerCase());
}

/**
 * A stem-initial consonant only assimilates when it stands alone. In a cluster
 * it survives: "praktik" -> "mempraktikkan" (not "memraktikkan"), "proses" ->
 * "memproses", "kritik" -> "mengkritik". Used when building a prefixed form.
 */
function startsWithCluster(stem: string): boolean {
  return stem.length >= 2 && !isVowel(stem[1]!);
}

/**
 * How to build the prefixed form from a stem, per language.
 *
 * `initials` lists the stem-initial graphemes the rule applies to; `prefix` is
 * what gets prepended; `dropsInitial` marks the assimilating cases where the
 * stem loses its first grapheme.
 *
 * Order matters: digraphs ("dh", "th", "ng", "ny", "kh") must be listed before
 * the single letters they start with, so matching is greedy.
 */
export interface PrefixForm {
  initials: string[];
  prefix: string;
  dropsInitial: boolean;
}

/** Indonesian meN- (Chaer 2002). */
export const INDONESIAN_PREFIX_FORMS: PrefixForm[] = [
  // meng- : vowels, g, h, kh
  { initials: ["kh"], prefix: "meng", dropsInitial: false },
  { initials: ["a", "e", "i", "o", "u", "g", "h"], prefix: "meng", dropsInitial: false },
  // meng- with k assimilating: konsumsi -> mengonsumsi
  { initials: ["k"], prefix: "meng", dropsInitial: true },
  // me- : r, l, w, y and the nasals (already nasal, nothing to assimilate)
  { initials: ["ny", "ng"], prefix: "me", dropsInitial: false },
  { initials: ["r", "l", "w", "y", "m", "n"], prefix: "me", dropsInitial: false },
  // mem- : b, f, v — and p assimilating: pesona -> memesona
  { initials: ["b", "f", "v"], prefix: "mem", dropsInitial: false },
  { initials: ["p"], prefix: "mem", dropsInitial: true },
  // men- : c, d, j — and t assimilating: tulis -> menulis
  { initials: ["c", "d", "j"], prefix: "men", dropsInitial: false },
  { initials: ["t"], prefix: "men", dropsInitial: true },
  // meny- : s assimilating: sikat -> menyikat
  { initials: ["s"], prefix: "meny", dropsInitial: true },
];

/** Javanese ater-ater anuswara (m-, n-, ny-, ng-). */
export const JAVANESE_PREFIX_FORMS: PrefixForm[] = [
  // m- : b kept (buru -> mburu); p and w assimilate (pangan -> mangan)
  { initials: ["b"], prefix: "m", dropsInitial: false },
  { initials: ["p", "w"], prefix: "m", dropsInitial: true },
  // n- : d/dh/j kept (dudut -> ndudut, jupuk -> njupuk); t/th assimilate
  { initials: ["dh"], prefix: "n", dropsInitial: false },
  { initials: ["d", "j"], prefix: "n", dropsInitial: false },
  { initials: ["th"], prefix: "n", dropsInitial: true },
  { initials: ["t"], prefix: "n", dropsInitial: true },
  // ny- : c and s assimilate (cukil -> nyukil, sikat -> nyikat)
  { initials: ["c", "s"], prefix: "ny", dropsInitial: true },
  // ng- : vowels, g, r, l kept (rasa -> ngrasa); k assimilates (kuras -> nguras)
  { initials: ["a", "e", "i", "o", "u", "g", "r", "l"], prefix: "ng", dropsInitial: false },
  { initials: ["k"], prefix: "ng", dropsInitial: true },
];

/**
 * Build the prefixed form of `stem`. Returns null when no rule covers the
 * stem's initial grapheme.
 *
 * A stem whose initial consonant sits in a cluster keeps that consonant even
 * when its rule normally assimilates, so "proses" yields "memproses".
 */
export function applyPrefix(stem: string, forms: PrefixForm[]): string | null {
  const lower = stem.toLowerCase();
  for (const form of forms) {
    for (const initial of form.initials) {
      if (!lower.startsWith(initial)) continue;
      const drop = form.dropsInitial && !startsWithCluster(lower);
      return form.prefix + (drop ? stem.slice(initial.length) : stem);
    }
  }
  return null;
}

/**
 * Reverse of a prefix: the surface marker seen in input, plus every stem
 * candidate it could have come from.
 *
 * `restores` holds the graphemes that may have been deleted; "" means nothing
 * was deleted. Candidate stem = restore + remainder.
 */
interface PrefixReversal {
  marker: string;
  restores: string[];
}

/**
 * Derive reversal entries from a forward table, so the two directions can never
 * drift apart. Longest marker first, so "meng" is tried before "men" and
 * "me" — otherwise "mengambil" would be read as "me" + "ngambil".
 */
function buildReversals(forms: PrefixForm[]): PrefixReversal[] {
  const byMarker = new Map<string, Set<string>>();
  for (const form of forms) {
    const set = byMarker.get(form.prefix) ?? new Set<string>();
    for (const initial of form.initials) {
      // A dropping rule means `initial` was deleted and must be restored; a
      // non-dropping rule leaves the stem intact, so nothing to restore.
      set.add(form.dropsInitial ? initial : "");
    }
    byMarker.set(form.prefix, set);
  }
  return [...byMarker.entries()]
    .map(([marker, restores]) => ({ marker, restores: [...restores] }))
    .sort((a, b) => b.marker.length - a.marker.length);
}

export const INDONESIAN_PREFIX_REVERSALS = buildReversals(INDONESIAN_PREFIX_FORMS);
export const JAVANESE_PREFIX_REVERSALS = buildReversals(JAVANESE_PREFIX_FORMS);

/** Shortest stem worth considering; guards against absurd splits. */
const MIN_STEM_LENGTH = 2;

export interface PrefixAnalysis {
  /** the dictionary stem this token was built from */
  stem: string;
  /** the surface prefix that was stripped, e.g. "men" or "n" */
  prefix: string;
}

/**
 * Find which stem `token` was prefixed from, trying every candidate the rules
 * allow and keeping the first that `isKnownStem` accepts.
 *
 * Markers are tried longest first, and within one marker the restoring
 * candidates come before the plain remainder — so "menulis" prefers "tulis"
 * over "ulis" when both would be spellable, while the dictionary still has the
 * final say.
 */
export function analyzePrefix(
  token: string,
  reversals: PrefixReversal[],
  isKnownStem: (stem: string) => boolean
): PrefixAnalysis | null {
  const lower = token.toLowerCase();
  for (const { marker, restores } of reversals) {
    if (!lower.startsWith(marker)) continue;
    const remainder = lower.slice(marker.length);
    if (remainder.length === 0) continue;

    // Restoring candidates first (longer stem), plain remainder last.
    const ordered = [...restores].sort((a, b) => b.length - a.length);
    for (const restore of ordered) {
      const stem = restore + remainder;
      if (stem.length < MIN_STEM_LENGTH) continue;
      if (isKnownStem(stem)) return { stem, prefix: marker };
    }
  }
  return null;
}

/**
 * Javanese `ater-ater` is register-neutral: the same nasal prefix is used in
 * ngoko, krama and inggil, so unlike the possessive suffixes there is no level
 * to infer from the prefix itself. The level comes from the stem's own
 * dictionary column instead.
 *
 * Exported for documentation purposes and to make the asymmetry with
 * `analyzeJavaneseSuffix` explicit at the call site.
 */
export const PREFIX_IS_LEVEL_NEUTRAL = true;

export type { Level };
