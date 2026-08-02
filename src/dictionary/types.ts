export type Level = "ngoko" | "krama" | "inggil";

export interface VocabEntry {
  vocabularyId: number;
  type: string | null;
  levels: Record<Level, string>;
  /** target-language meanings, preserving DB `order` */
  meanings: string[];
}

/** A single pattern to feed into the Aho-Corasick automaton. */
export interface DictPattern {
  /** normalized surface form used for matching */
  pattern: string;
  /** which Javanese level this surface form came from */
  level: Level;
  entry: VocabEntry;
}

export interface Dictionary {
  patterns: DictPattern[];
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
