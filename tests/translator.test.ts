import { test, expect } from "bun:test";
import { Translator } from "../src/matcher/translator";
import type { Dictionary, VocabEntry } from "../src/dictionary/types";

function entry(id: number, levels: VocabEntry["levels"], meanings: string[]): VocabEntry {
  return { vocabularyId: id, type: null, levels, meanings };
}

const abang = entry(1, { ngoko: "abang", krama: "abrit", inggil: "abrit" }, ["merah"]);
const adang = entry(2, { ngoko: "adang", krama: "adang", inggil: "adang" }, ["menanak nasi"]);
const nasiPhrase = entry(3, { ngoko: "sega abang", krama: "sekul abrit", inggil: "sekul abrit" }, [
  "nasi merah",
]);

const dict: Dictionary = {
  patterns: [
    { pattern: "abang", level: "ngoko", entry: abang },
    { pattern: "abrit", level: "krama", entry: abang },
    { pattern: "adang", level: "ngoko", entry: adang },
    { pattern: "sega abang", level: "ngoko", entry: nasiPhrase },
    { pattern: "sekul abrit", level: "krama", entry: nasiPhrase },
  ],
};

test("translates a single word and replaces it in output", () => {
  const t = new Translator(dict);
  const res = t.translate("klambiku abang");
  expect(res.matches).toHaveLength(1);
  expect(res.matches[0]!.source).toBe("abang");
  expect(res.matches[0]!.translation).toBe("merah");
  expect(res.output).toBe("klambiku merah");
});

test("matching is case-insensitive and preserves surrounding punctuation", () => {
  const t = new Translator(dict);
  const res = t.translate("Abang!");
  expect(res.matches).toHaveLength(1);
  expect(res.matches[0]!.source).toBe("Abang");
  expect(res.output).toBe("merah!");
});

test("does not match inside a longer word", () => {
  const t = new Translator(dict);
  const res = t.translate("sembarang");
  expect(res.matches).toHaveLength(0);
  expect(res.output).toBe("sembarang");
});

test("prefers the longest match on overlap (phrase over word)", () => {
  const t = new Translator(dict);
  const res = t.translate("aku mangan sega abang esuk");
  expect(res.matches).toHaveLength(1);
  expect(res.matches[0]!.source).toBe("sega abang");
  expect(res.matches[0]!.translation).toBe("nasi merah");
  expect(res.output).toBe("aku mangan nasi merah esuk");
});

test("translates multiple words in one sentence", () => {
  const t = new Translator(dict);
  const res = t.translate("abang adang");
  expect(res.matches.map((m) => m.translation)).toEqual(["merah", "menanak nasi"]);
  expect(res.output).toBe("merah menanak nasi");
});

test("tokens concatenate back to the exact input (lossless)", () => {
  const t = new Translator(dict);
  for (const text of ["klambiku abang", "Abang!", "aku mangan sega abang esuk", ""]) {
    const res = t.translate(text);
    expect(res.tokens.map((tok) => tok.text).join("")).toBe(text);
  }
});

test("tokens mark matched vs unmatched segments", () => {
  const t = new Translator(dict);
  const res = t.translate("klambiku abang");
  expect(res.tokens).toHaveLength(2);
  expect(res.tokens[0]!.match).toBeNull();
  expect(res.tokens[0]!.text).toBe("klambiku ");
  expect(res.tokens[1]!.match).not.toBeNull();
  expect(res.tokens[1]!.text).toBe("abang");
  expect(res.tokens[1]!.match!.meanings).toEqual(["merah"]);
});

test("tokens expose full meanings for a multi-meaning entry via match", () => {
  const multi = { vocabularyId: 7, type: null, levels: { ngoko: "aba", krama: "dhawuh", inggil: "dhawuh" }, meanings: ["arahan", "instruksi", "kode"] };
  const t = new Translator({
    patterns: [{ pattern: "aba", level: "ngoko", entry: multi }],
  });
  const res = t.translate("aba kuwi");
  const matched = res.tokens.find((tok) => tok.match !== null)!;
  expect(matched.match!.meanings).toEqual(["arahan", "instruksi", "kode"]);
  expect(matched.match!.translation).toBe("arahan");
});
