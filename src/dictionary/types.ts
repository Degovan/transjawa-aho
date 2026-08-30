export type Level = "ngoko" | "krama" | "inggil";

export const LEVELS: Level[] = ["ngoko", "krama", "inggil"];

export interface VocabEntry {
  vocabularyId: number;
  type: string | null;
  levels: Record<Level, string>;
  /** target-language meanings, preserving DB `order` */
  meanings: string[];
}

/** A single pattern to feed into the Aho-Corasick automaton (Javanese -> target language). */
export interface DictPattern {
  /** normalized surface form used for matching */
  pattern: string;
  /** which Javanese level this surface form came from */
  level: Level;
  entry: VocabEntry;
}

/** A single pattern for the reverse direction (target language -> Javanese). */
export interface ReversePattern {
  /** normalized target-language surface form used for matching */
  pattern: string;
  entry: VocabEntry;
}

export interface Dictionary {
  patterns: DictPattern[];
  /**
   * Built from `meanings`, used to match target-language text back to
   * Javanese entries. Optional for backward compatibility with existing
   * in-memory `Dictionary` literals (e.g. tests) that only exercise the
   * Javanese -> target-language direction.
   */
  reversePatterns?: ReversePattern[];
}

/** Raw rows as read from the database, decoupled from persistence layer. */
export interface VocabRow {
  id: number;
  ngoko: string;
  krama: string;
  inggil: string;
  type: string | null;
}

export interface MeaningRow {
  vocabulary_id: number;
  meaning: string;
}
