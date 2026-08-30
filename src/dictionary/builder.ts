import type {
  Dictionary,
  DictPattern,
  MeaningRow,
  ReversePattern,
  VocabEntry,
  VocabRow,
} from "./types";
import { LEVELS } from "./types";
import { normalize } from "./normalize";

/**
 * Pure transform: turn raw DB rows into a Dictionary. No I/O here so it can be
 * unit-tested with in-memory fixtures.
 */
export function buildDictionaryFromRows(
  vocabRows: VocabRow[],
  meaningRows: MeaningRow[]
): Dictionary {
  const entries = new Map<number, VocabEntry>();
  for (const v of vocabRows) {
    entries.set(v.id, {
      vocabularyId: v.id,
      type: v.type,
      levels: { ngoko: v.ngoko, krama: v.krama, inggil: v.inggil },
      meanings: [],
    });
  }

  for (const m of meaningRows) {
    entries.get(m.vocabulary_id)?.meanings.push(m.meaning);
  }

  // One pattern per distinct surface form per entry. If two levels share the
  // same word (e.g. krama == inggil), collapse into a single pattern.
  const patterns: DictPattern[] = [];
  // Reverse direction: one pattern per distinct meaning surface form per
  // entry, so target-language text can be matched back to the Javanese entry.
  const reversePatterns: ReversePattern[] = [];
  for (const entry of entries.values()) {
    const seen = new Set<string>();
    for (const level of LEVELS) {
      const raw = entry.levels[level];
      if (!raw) continue;
      const pattern = normalize(raw);
      if (!pattern || seen.has(pattern)) continue;
      seen.add(pattern);
      patterns.push({ pattern, level, entry });
    }

    const seenMeanings = new Set<string>();
    for (const raw of entry.meanings) {
      const pattern = normalize(raw);
      if (!pattern || seenMeanings.has(pattern)) continue;
      seenMeanings.add(pattern);
      reversePatterns.push({ pattern, entry });
    }
  }

  return { patterns, reversePatterns };
}
