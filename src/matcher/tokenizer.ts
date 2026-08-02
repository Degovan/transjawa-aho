import { normalize } from "../dictionary/normalize";

export interface Token {
  /** normalized text used for matching */
  norm: string;
  /** original text as it appeared in the input */
  raw: string;
  /** char offset of the token start in the original string */
  start: number;
  /** char offset one past the token end */
  end: number;
}

/**
 * Split text into word tokens, keeping original text and char offsets so the
 * output can be reconstructed with surrounding punctuation/whitespace intact.
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /\p{L}+(?:['-]\p{L}+)*/gu;
  for (const m of text.matchAll(re)) {
    const raw = m[0];
    tokens.push({
      raw,
      norm: normalize(raw),
      start: m.index,
      end: m.index + raw.length,
    });
  }
  return tokens;
}
