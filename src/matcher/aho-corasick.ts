import LibAhoCorasick from "modern-ahocorasick";

/**
 * Token-based Aho-Corasick automaton.
 *
 * Backed by the char-based `modern-ahocorasick` library. Patterns and haystack
 * are sequences of string tokens (words), not characters. To preserve word
 * boundaries on top of a char-based matcher, every token is wrapped with a
 * sentinel char (SEP), so "abang" never matches inside "sembarang" and
 * multi-word phrases still match as a unit.
 */

const SEP = "\x01";

export interface AcMatch<T> {
  /** token index where the match starts (inclusive) */
  start: number;
  /** token index where the match ends (inclusive) */
  end: number;
  /** number of tokens in the matched pattern */
  length: number;
  payload: T;
}

/** Wrap a token sequence into a sentinel-delimited string key. */
function wrap(tokens: string[]): string {
  return SEP + tokens.join(SEP) + SEP;
}

export class AhoCorasick<T> {
  private keywords: string[] = [];
  /** wrapped keyword -> patterns (token length + payload) sharing that surface */
  private payloads = new Map<string, Array<{ length: number; payload: T }>>();
  private lib: LibAhoCorasick | null = null;

  /** Add a pattern (array of tokens) mapped to a payload. */
  add(tokens: string[], payload: T): void {
    if (tokens.length === 0) return;
    const key = wrap(tokens);
    const bucket = this.payloads.get(key);
    if (bucket) {
      bucket.push({ length: tokens.length, payload });
    } else {
      this.payloads.set(key, [{ length: tokens.length, payload }]);
      this.keywords.push(key);
    }
    this.lib = null;
  }

  /** Build the underlying automaton. Called lazily by search(). */
  build(): void {
    this.lib = new LibAhoCorasick(this.keywords);
  }

  /** Find every pattern occurrence in the token sequence. */
  search(tokens: string[]): AcMatch<T>[] {
    if (!this.lib) this.build();

    // Build the wrapped haystack and remember where each token starts.
    let haystack = SEP;
    const charToToken = new Map<number, number>();
    for (let i = 0; i < tokens.length; i++) {
      charToToken.set(haystack.length, i);
      haystack += tokens[i]! + SEP;
    }

    const matches: AcMatch<T>[] = [];
    for (const [endChar, keys] of this.lib!.search(haystack)) {
      for (const key of keys) {
        const bucket = this.payloads.get(key);
        if (!bucket) continue;
        const startChar = endChar - key.length + 1; // leading sentinel of match
        const start = charToToken.get(startChar + 1); // first real token char
        if (start === undefined) continue;
        for (const { length, payload } of bucket) {
          matches.push({ start, end: start + length - 1, length, payload });
        }
      }
    }
    return matches;
  }
}
