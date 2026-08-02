import type { Dictionary, Level, VocabEntry } from "../dictionary/types";
import { AhoCorasick } from "./aho-corasick";
import { tokenize, type Token } from "./tokenizer";

export interface TranslationMatch {
  /** original Javanese surface text as it appeared in the input */
  source: string;
  /** chosen Indonesian meaning (first / primary) */
  translation: string;
  /** all available Indonesian meanings for this entry */
  meanings: string[];
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

export class Translator {
  private ac = new AhoCorasick<{ entry: VocabEntry; level: Level }>();

  constructor(dict: Dictionary) {
    for (const p of dict.patterns) {
      const tokens = p.pattern.split(" ");
      this.ac.add(tokens, { entry: p.entry, level: p.level });
    }
    this.ac.build();
  }

  translate(text: string): TranslateResult {
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
