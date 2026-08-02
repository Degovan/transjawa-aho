import type { Dictionary, DictPattern, Level, MeaningRow, VocabEntry, VocabRow } from "./types";
import { normalize } from "./normalize";

const LEVELS: Level[] = ["ngoko", "krama", "inggil"];

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
  }

  return { patterns };
}
