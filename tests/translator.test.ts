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
  reversePatterns: [
    { pattern: "merah", entry: abang },
    { pattern: "menanak nasi", entry: adang },
    { pattern: "nasi merah", entry: nasiPhrase },
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

// --- id -> jv (reverse direction) ---

test("id-jv: translates a single word to the requested level", () => {
  const t = new Translator(dict);
  const res = t.translate("bajuku merah", { direction: "id-jv", level: "krama" });
  expect(res.matches).toHaveLength(1);
  expect(res.matches[0]!.source).toBe("merah");
  expect(res.matches[0]!.translation).toBe("abrit");
  expect(res.matches[0]!.level).toBe("krama");
  expect(res.output).toBe("bajuku abrit");
});

test("id-jv: meanings are Javanese, not the Indonesian source", () => {
  const t = new Translator(dict);
  const res = t.translate("merah", { direction: "id-jv", level: "ngoko" });
  expect(res.matches[0]!.meanings).toEqual(["abang"]);
  expect(res.matches[0]!.meanings).not.toContain("merah");
});

test("id-jv: meanings never mix levels — only forms at the requested level", () => {
  // aba (ngoko) / titah (krama) is one entry; dhawuh/dhawuh is a synonym entry.
  const aba = entry(10, { ngoko: "aba", krama: "titah", inggil: "titah" }, ["perintah"]);
  const dhawuh = entry(11, { ngoko: "dhawuh", krama: "dhawuh", inggil: "dhawuh" }, ["perintah"]);
  const t = new Translator({
    patterns: [],
    reversePatterns: [
      { pattern: "perintah", entry: aba },
      { pattern: "perintah", entry: dhawuh },
    ],
  });

  const krama = t.translate("perintah", { direction: "id-jv", level: "krama" });
  expect(krama.matches[0]!.translation).toBe("titah");
  // must NOT contain the ngoko form "aba"
  expect(krama.matches[0]!.meanings).toEqual(["titah", "dhawuh"]);
  expect(krama.matches[0]!.meanings).not.toContain("aba");

  const ngoko = t.translate("perintah", { direction: "id-jv", level: "ngoko" });
  expect(ngoko.matches[0]!.translation).toBe("aba");
  expect(ngoko.matches[0]!.meanings).toEqual(["aba", "dhawuh"]);
  expect(ngoko.matches[0]!.meanings).not.toContain("titah");
});

test("id-jv: defaults to ngoko level when none is specified", () => {
  const t = new Translator(dict);
  const res = t.translate("merah", { direction: "id-jv" });
  expect(res.matches[0]!.translation).toBe("abang");
  expect(res.matches[0]!.level).toBe("ngoko");
});

test("id-jv: prefers the longest match on overlap (phrase over word)", () => {
  const t = new Translator(dict);
  const res = t.translate("aku mangan nasi merah esuk", { direction: "id-jv", level: "ngoko" });
  expect(res.matches).toHaveLength(1);
  expect(res.matches[0]!.source).toBe("nasi merah");
  expect(res.matches[0]!.translation).toBe("sega abang");
  expect(res.output).toBe("aku mangan sega abang esuk");
});

test("id-jv: strips '-nya' and re-attaches the Javanese suffix per level", () => {
  const agama = entry(20, { ngoko: "agama", krama: "agami", inggil: "agami" }, ["agama"]);
  const t = new Translator({
    patterns: [],
    reversePatterns: [{ pattern: "agama", entry: agama }],
  });

  const ngoko = t.translate("agamanya", { direction: "id-jv", level: "ngoko" });
  expect(ngoko.matches).toHaveLength(1);
  expect(ngoko.matches[0]!.source).toBe("agamanya");
  expect(ngoko.matches[0]!.translation).toBe("agamane");
  expect(ngoko.matches[0]!.affix).toEqual({ suffix: "nya", stem: "agama" });
  expect(ngoko.output).toBe("agamane");

  const krama = t.translate("agamanya", { direction: "id-jv", level: "krama" });
  expect(krama.matches[0]!.translation).toBe("agaminipun");
  expect(krama.output).toBe("agaminipun");
});

test("id-jv: consonant-final stems take -e / -ipun instead of -ne / -nipun", () => {
  const rumah = entry(21, { ngoko: "omah", krama: "griya", inggil: "dalem" }, ["rumah"]);
  const t = new Translator({
    patterns: [],
    reversePatterns: [{ pattern: "rumah", entry: rumah }],
  });

  expect(t.translate("rumahnya", { direction: "id-jv", level: "ngoko" }).output).toBe("omahe");
  // "griya" ends in a vowel -> -nipun
  expect(t.translate("rumahnya", { direction: "id-jv", level: "krama" }).output).toBe(
    "griyanipun"
  );
});

test("id-jv: affix pass leaves unknown stems untouched", () => {
  const t = new Translator(dict);
  const res = t.translate("kursinya", { direction: "id-jv", level: "ngoko" });
  expect(res.matches).toHaveLength(0);
  expect(res.output).toBe("kursinya");
});

test("id-jv: exact dictionary match wins over affix stripping", () => {
  // "hanya" must not be split into "ha" + "nya"
  const hanya = entry(22, { ngoko: "mung", krama: "namung", inggil: "namung" }, ["hanya"]);
  const ha = entry(23, { ngoko: "ha", krama: "ha", inggil: "ha" }, ["ha"]);
  const t = new Translator({
    patterns: [],
    reversePatterns: [
      { pattern: "hanya", entry: hanya },
      { pattern: "ha", entry: ha },
    ],
  });
  const res = t.translate("hanya", { direction: "id-jv", level: "ngoko" });
  expect(res.matches).toHaveLength(1);
  expect(res.matches[0]!.translation).toBe("mung");
  expect(res.matches[0]!.affix).toBeUndefined();
});

test("id-jv: mixes plain matches and affixed matches in one sentence, in order", () => {
  const agama = entry(24, { ngoko: "agama", krama: "agami", inggil: "agami" }, ["agama"]);
  const t = new Translator({
    patterns: [],
    reversePatterns: [
      { pattern: "agama", entry: agama },
      { pattern: "merah", entry: abang },
    ],
  });
  const res = t.translate("agamanya merah", { direction: "id-jv", level: "ngoko" });
  expect(res.matches.map((m) => m.translation)).toEqual(["agamane", "abang"]);
  expect(res.output).toBe("agamane abang");
  // tokens must still be lossless
  expect(res.tokens.map((tok) => tok.text).join("")).toBe("agamanya merah");
});

test("id-jv: '-ku' is a bound suffix in ngoko but definite + free pronoun in krama", () => {
  const agama = entry(25, { ngoko: "agama", krama: "agami", inggil: "agami" }, ["agama"]);
  const t = new Translator({
    patterns: [],
    reversePatterns: [{ pattern: "agama", entry: agama }],
  });

  const ngoko = t.translate("agamaku", { direction: "id-jv", level: "ngoko" });
  expect(ngoko.matches[0]!.translation).toBe("agamaku");
  expect(ngoko.output).toBe("agamaku");

  const krama = t.translate("agamaku", { direction: "id-jv", level: "krama" });
  expect(krama.matches[0]!.translation).toBe("agaminipun kula");
  expect(krama.matches[0]!.affix).toEqual({ suffix: "ku", stem: "agama" });
  expect(krama.output).toBe("agaminipun kula");

  expect(t.translate("agamaku", { direction: "id-jv", level: "inggil" }).output).toBe(
    "agaminipun kula"
  );
});

test("id-jv: consonant-final stems use -ipun before the free pronoun", () => {
  const rumah = entry(26, { ngoko: "omah", krama: "griya", inggil: "dalem" }, ["rumah"]);
  const t = new Translator({
    patterns: [],
    reversePatterns: [{ pattern: "rumah", entry: rumah }],
  });
  expect(t.translate("rumahku", { direction: "id-jv", level: "ngoko" }).output).toBe("omahku");
  // "griya" is vowel-final -> -nipun
  expect(t.translate("rumahku", { direction: "id-jv", level: "krama" }).output).toBe(
    "griyanipun kula"
  );
  // "dalem" is consonant-final -> -ipun
  expect(t.translate("rumahku", { direction: "id-jv", level: "inggil" }).output).toBe(
    "dalemipun kula"
  );
});

test("id-jv: '-mu' uses sampeyan for krama but panjenengan for inggil", () => {
  const agama = entry(27, { ngoko: "agama", krama: "agami", inggil: "agami" }, ["agama"]);
  const t = new Translator({
    patterns: [],
    reversePatterns: [{ pattern: "agama", entry: agama }],
  });
  expect(t.translate("agamamu", { direction: "id-jv", level: "ngoko" }).output).toBe("agamamu");
  expect(t.translate("agamamu", { direction: "id-jv", level: "krama" }).output).toBe(
    "agaminipun sampeyan"
  );
  // inggil is more deferential than krama, hence panjenengan
  expect(t.translate("agamamu", { direction: "id-jv", level: "inggil" }).output).toBe(
    "agaminipun panjenengan"
  );
});

test("id-jv: multi-word affix output keeps tokens lossless", () => {
  const agama = entry(28, { ngoko: "agama", krama: "agami", inggil: "agami" }, ["agama"]);
  const t = new Translator({
    patterns: [],
    reversePatterns: [{ pattern: "agama", entry: agama }],
  });
  const res = t.translate("Agamaku beda.", { direction: "id-jv", level: "krama" });
  expect(res.output).toBe("agaminipun kula beda.");
  // tokens still reproduce the ORIGINAL input, not the output
  expect(res.tokens.map((tok) => tok.text).join("")).toBe("Agamaku beda.");
});

test("id-jv: falls back to another level when the requested one is empty in the DB", () => {
  const partial = entry(8, { ngoko: "turu", krama: "", inggil: "sare" }, ["tidur"]);
  const t = new Translator({
    patterns: [{ pattern: "turu", level: "ngoko", entry: partial }],
    reversePatterns: [{ pattern: "tidur", entry: partial }],
  });
  const res = t.translate("tidur", { direction: "id-jv", level: "krama" });
  expect(res.matches[0]!.translation).toBe("turu");
  expect(res.matches[0]!.level).toBe("ngoko");
  // fell back to ngoko; no synonym entries, so only the resolved form
  expect(res.matches[0]!.meanings).toEqual(["turu"]);
});

test("id-jv: jv-id direction is still the default when options are omitted", () => {
  const t = new Translator(dict);
  const res = t.translate("abang");
  expect(res.matches[0]!.translation).toBe("merah");
});
