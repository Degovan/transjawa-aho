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

// --- jv -> id affix handling ---

const agamaEntry = entry(30, { ngoko: "agama", krama: "agami", inggil: "agami" }, ["agama"]);
const omahEntry = entry(31, { ngoko: "omah", krama: "griya", inggil: "dalem" }, ["rumah"]);

/** Dictionary carrying both directions for the same entries. */
const bothWays: Dictionary = {
  patterns: [
    { pattern: "agama", level: "ngoko", entry: agamaEntry },
    { pattern: "agami", level: "krama", entry: agamaEntry },
    { pattern: "omah", level: "ngoko", entry: omahEntry },
    { pattern: "griya", level: "krama", entry: omahEntry },
    { pattern: "dalem", level: "inggil", entry: omahEntry },
    { pattern: "abang", level: "ngoko", entry: abang },
    { pattern: "abrit", level: "krama", entry: abang },
  ],
  reversePatterns: [
    { pattern: "agama", entry: agamaEntry },
    { pattern: "rumah", entry: omahEntry },
    { pattern: "merah", entry: abang },
  ],
};

test("jv-id: reads a bound ngoko suffix and restores the Indonesian one", () => {
  const t = new Translator(bothWays);
  const res = t.translate("agamane");
  expect(res.matches).toHaveLength(1);
  expect(res.matches[0]!.translation).toBe("agamanya");
  expect(res.matches[0]!.affix).toEqual({ suffix: "ne", stem: "agama" });
  expect(res.output).toBe("agamanya");
});

test("jv-id: infers the level from the affix form", () => {
  const t = new Translator(bothWays);
  expect(t.translate("agamane").matches[0]!.level).toBe("ngoko");
  expect(t.translate("agaminipun").matches[0]!.level).toBe("krama");
});

test("jv-id: consumes the free pronoun of a multi-word affix", () => {
  const t = new Translator(bothWays);

  const kula = t.translate("agaminipun kula");
  expect(kula.matches).toHaveLength(1);
  expect(kula.matches[0]!.source).toBe("agaminipun kula");
  expect(kula.matches[0]!.translation).toBe("agamaku");
  expect(kula.output).toBe("agamaku");

  // sampeyan marks krama, panjenengan marks inggil; both map back to "-mu"
  expect(t.translate("agaminipun sampeyan").output).toBe("agamamu");
  expect(t.translate("agaminipun sampeyan").matches[0]!.level).toBe("krama");
  expect(t.translate("agaminipun panjenengan").output).toBe("agamamu");
  expect(t.translate("agaminipun panjenengan").matches[0]!.level).toBe("inggil");
});

test("jv-id: handles the -e / -ipun allomorphs on consonant-final stems", () => {
  const t = new Translator(bothWays);
  expect(t.translate("omahe").output).toBe("rumahnya");
  expect(t.translate("griyanipun kula").output).toBe("rumahku");
  expect(t.translate("dalemipun panjenengan").output).toBe("rumahmu");
});

test("jv-id: mixes plain and affixed matches, staying lossless", () => {
  const t = new Translator(bothWays);
  const res = t.translate("Omahe abang.");
  expect(res.output).toBe("rumahnya merah.");
  expect(res.tokens.map((tok) => tok.text).join("")).toBe("Omahe abang.");
});

test("jv-id: exact dictionary match still wins over affix stripping", () => {
  // "dalem" is a real entry; it must not be read as "dal" + "em"
  const t = new Translator(bothWays);
  const res = t.translate("dalem");
  expect(res.matches[0]!.translation).toBe("rumah");
  expect(res.matches[0]!.affix).toBeUndefined();
});

test("jv-id: leaves unknown stems alone", () => {
  const t = new Translator(bothWays);
  const res = t.translate("kursine");
  expect(res.matches).toHaveLength(0);
  expect(res.output).toBe("kursine");
});

test("round trip id -> jv -> id returns the original for every level", () => {
  const t = new Translator(bothWays);
  for (const level of ["ngoko", "krama", "inggil"] as const) {
    for (const src of ["agamanya", "agamaku", "agamamu", "rumahnya"]) {
      const jv = t.translate(src, { direction: "id-jv", level }).output;
      expect(t.translate(jv).output).toBe(src);
    }
  }
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

// --- affixes on multi-word vocabulary ---

const anakKedua = entry(
  40,
  { ngoko: "anak nomer loro", krama: "putra nomer kalih", inggil: "putra nomer kalih" },
  ["anak kedua"]
);

const phraseDict: Dictionary = {
  patterns: [
    { pattern: "anak nomer loro", level: "ngoko", entry: anakKedua },
    { pattern: "putra nomer kalih", level: "krama", entry: anakKedua },
    { pattern: "abang", level: "ngoko", entry: abang },
    { pattern: "abrit", level: "krama", entry: abang },
  ],
  reversePatterns: [
    { pattern: "anak kedua", entry: anakKedua },
    { pattern: "merah", entry: abang },
  ],
};

test("id-jv: attaches a suffix to a multi-word entry", () => {
  const t = new Translator(phraseDict);

  const ngoko = t.translate("anak keduaku", { direction: "id-jv", level: "ngoko" });
  expect(ngoko.matches).toHaveLength(1);
  expect(ngoko.matches[0]!.source).toBe("anak keduaku");
  expect(ngoko.matches[0]!.translation).toBe("anak nomer loroku");
  expect(ngoko.matches[0]!.affix).toEqual({ suffix: "ku", stem: "anak kedua" });
  expect(ngoko.output).toBe("anak nomer loroku");

  const krama = t.translate("anak keduaku", { direction: "id-jv", level: "krama" });
  expect(krama.output).toBe("putra nomer kalihipun kula");
});

test("id-jv: multi-word entry works for every suffix", () => {
  const t = new Translator(phraseDict);
  const at = (text: string, level: "ngoko" | "krama") =>
    t.translate(text, { direction: "id-jv", level }).output;

  expect(at("anak keduanya", "ngoko")).toBe("anak nomer lorone");
  expect(at("anak keduamu", "ngoko")).toBe("anak nomer loromu");
  expect(at("anak keduanya", "krama")).toBe("putra nomer kalihipun");
  expect(at("anak keduamu", "krama")).toBe("putra nomer kalihipun sampeyan");
});

test("id-jv: affixed phrase coexists with other matches in one sentence", () => {
  const t = new Translator(phraseDict);
  const res = t.translate("anak keduaku merah", { direction: "id-jv", level: "ngoko" });
  expect(res.matches).toHaveLength(2);
  expect(res.output).toBe("anak nomer loroku abang");
  expect(res.tokens.map((tok) => tok.text).join("")).toBe("anak keduaku merah");
});

test("id-jv: bare multi-word entry still matches without any affix", () => {
  const t = new Translator(phraseDict);
  const res = t.translate("anak kedua", { direction: "id-jv", level: "ngoko" });
  expect(res.matches[0]!.affix).toBeUndefined();
  expect(res.output).toBe("anak nomer loro");
});

test("jv-id: reads a suffix off a multi-word entry", () => {
  const t = new Translator(phraseDict);

  const ne = t.translate("anak nomer lorone");
  expect(ne.matches).toHaveLength(1);
  expect(ne.matches[0]!.source).toBe("anak nomer lorone");
  expect(ne.matches[0]!.translation).toBe("anak keduanya");
  expect(ne.matches[0]!.affix).toEqual({ suffix: "ne", stem: "anak nomer loro" });

  expect(t.translate("anak nomer loroku").output).toBe("anak keduaku");
  expect(t.translate("putra nomer kalihipun").output).toBe("anak keduanya");
  // multi-word affix on a multi-word entry
  expect(t.translate("putra nomer kalihipun kula").output).toBe("anak keduaku");
});

test("jv-id: affixed phrase coexists with other matches", () => {
  const t = new Translator(phraseDict);
  const res = t.translate("anak nomer lorone abang");
  expect(res.matches).toHaveLength(2);
  expect(res.output).toBe("anak keduanya merah");
});

test("round trip works for multi-word entries", () => {
  const t = new Translator(phraseDict);
  for (const level of ["ngoko", "krama"] as const) {
    for (const src of ["anak keduanya", "anak keduaku", "anak keduamu"]) {
      const jv = t.translate(src, { direction: "id-jv", level }).output;
      expect(t.translate(jv).output).toBe(src);
    }
  }
});

test("phrase affix does not steal a token already used by another match", () => {
  // "merah" is matched on its own, so it cannot become the lead word of a phrase
  const t = new Translator(phraseDict);
  const res = t.translate("merah anak keduaku", { direction: "id-jv", level: "ngoko" });
  expect(res.output).toBe("abang anak nomer loroku");
  expect(res.matches).toHaveLength(2);
});

test("longest phrase wins when several candidates share a final word", () => {
  const kedua = entry(41, { ngoko: "loro", krama: "kalih", inggil: "kalih" }, ["kedua"]);
  const t = new Translator({
    patterns: [{ pattern: "loro", level: "ngoko", entry: kedua }],
    reversePatterns: [
      { pattern: "kedua", entry: kedua },
      { pattern: "anak kedua", entry: anakKedua },
    ],
  });
  // "anak keduaku" must use the two-word entry, not just "kedua"
  expect(t.translate("anak keduaku", { direction: "id-jv", level: "ngoko" }).output).toBe(
    "anak nomer loroku"
  );
  // standalone "keduaku" falls back to the single-word entry
  expect(t.translate("keduaku", { direction: "id-jv", level: "ngoko" }).output).toBe("loroku");
});

// --- verbal prefixes (meN- / ater-ater) ---

const tulis = entry(50, { ngoko: "tulis", krama: "serat", inggil: "serat" }, ["tulis"]);

const prefixDict: Dictionary = {
  patterns: [
    { pattern: "tulis", level: "ngoko", entry: tulis },
    { pattern: "serat", level: "krama", entry: tulis },
    { pattern: "abang", level: "ngoko", entry: abang },
  ],
  reversePatterns: [
    { pattern: "tulis", entry: tulis },
    { pattern: "merah", entry: abang },
  ],
};

test("id-jv: reconstructs a meN- stem and applies the Javanese prefix", () => {
  const t = new Translator(prefixDict);

  const ngoko = t.translate("menulis", { direction: "id-jv", level: "ngoko" });
  expect(ngoko.matches).toHaveLength(1);
  expect(ngoko.matches[0]!.translation).toBe("nulis");
  expect(ngoko.matches[0]!.prefix).toEqual({ prefix: "men", stem: "tulis" });
  expect(ngoko.output).toBe("nulis");

  // krama stem "serat" takes ny- -> nyerat
  expect(t.translate("menulis", { direction: "id-jv", level: "krama" }).output).toBe("nyerat");
});

test("jv-id: reconstructs an ater-ater stem and applies meN-", () => {
  const t = new Translator(prefixDict);

  const res = t.translate("nulis");
  expect(res.matches).toHaveLength(1);
  expect(res.matches[0]!.translation).toBe("menulis");
  expect(res.matches[0]!.prefix).toEqual({ prefix: "n", stem: "tulis" });

  expect(t.translate("nyerat").output).toBe("menulis");
});

test("an explicit dictionary entry beats prefix reconstruction", () => {
  // The prefixed form is its own entry with a distinct id
  const nulisEntry = entry(51, { ngoko: "nulis", krama: "nyerat", inggil: "nyerat" }, ["menulis"]);
  const t = new Translator({
    patterns: [
      { pattern: "tulis", level: "ngoko", entry: tulis },
      { pattern: "nulis", level: "ngoko", entry: nulisEntry },
      { pattern: "nyerat", level: "krama", entry: nulisEntry },
    ],
    reversePatterns: [
      { pattern: "tulis", entry: tulis },
      { pattern: "menulis", entry: nulisEntry },
    ],
  });

  const idToJv = t.translate("menulis", { direction: "id-jv", level: "ngoko" });
  expect(idToJv.matches[0]!.vocabularyId).toBe(51);
  expect(idToJv.matches[0]!.prefix).toBeUndefined();

  const jvToId = t.translate("nulis");
  expect(jvToId.matches[0]!.vocabularyId).toBe(51);
  expect(jvToId.matches[0]!.prefix).toBeUndefined();
});

test("prefix pass leaves unknown stems untouched", () => {
  const t = new Translator(prefixDict);
  expect(t.translate("menggoreng", { direction: "id-jv", level: "ngoko" }).matches).toHaveLength(0);
  expect(t.translate("ngoyak").matches).toHaveLength(0);
});

test("all three passes coexist in one sentence", () => {
  const agama = entry(52, { ngoko: "agama", krama: "agami", inggil: "agami" }, ["agama"]);
  const t = new Translator({
    patterns: [
      { pattern: "tulis", level: "ngoko", entry: tulis },
      { pattern: "agama", level: "ngoko", entry: agama },
      { pattern: "abang", level: "ngoko", entry: abang },
    ],
    reversePatterns: [
      { pattern: "tulis", entry: tulis },
      { pattern: "agama", entry: agama },
      { pattern: "merah", entry: abang },
    ],
  });

  const res = t.translate("menulis agamanya merah", { direction: "id-jv", level: "ngoko" });
  expect(res.output).toBe("nulis agamane abang");
  expect(res.matches).toHaveLength(3);
  expect(res.matches[0]!.prefix).toBeDefined(); // menulis
  expect(res.matches[1]!.affix).toBeDefined(); // agamanya
  expect(res.matches[2]!.prefix).toBeUndefined(); // merah, plain
  expect(res.matches[2]!.affix).toBeUndefined();
  expect(res.tokens.map((tok) => tok.text).join("")).toBe("menulis agamanya merah");
});

test("prefix round trip id -> jv -> id", () => {
  const t = new Translator(prefixDict);
  const jv = t.translate("menulis", { direction: "id-jv", level: "ngoko" }).output;
  expect(jv).toBe("nulis");
  expect(t.translate(jv).output).toBe("menulis");
});
