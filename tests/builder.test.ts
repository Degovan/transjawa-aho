import { test, expect } from "bun:test";
import { buildDictionaryFromRows } from "../src/dictionary/builder";
import type { MeaningRow, VocabRow } from "../src/dictionary/types";

const vocabRows: VocabRow[] = [
  { id: 1, ngoko: "abang", krama: "abrit", inggil: "abrit", type: "sifat" },
  { id: 2, ngoko: "Aba", krama: "dhawuh", inggil: "dhawuh", type: "benda" },
];

const meaningRows: MeaningRow[] = [
  { vocabulary_id: 1, meaning: "merah" },
  { vocabulary_id: 2, meaning: "arahan" },
  { vocabulary_id: 2, meaning: "instruksi" },
];

test("collapses duplicate surface forms across levels", () => {
  const { patterns } = buildDictionaryFromRows(vocabRows, meaningRows);
  // vocab 1: abang + abrit (krama==inggil) => 2 patterns
  // vocab 2: aba + dhawuh (krama==inggil)  => 2 patterns
  expect(patterns.length).toBe(4);

  const abrit = patterns.filter((p) => p.pattern === "abrit");
  expect(abrit.length).toBe(1);
  expect(abrit[0]!.level).toBe("krama");
});

test("normalizes surface forms into patterns", () => {
  const { patterns } = buildDictionaryFromRows(vocabRows, meaningRows);
  const aba = patterns.find((p) => p.pattern === "aba");
  expect(aba).toBeDefined();
  expect(aba!.level).toBe("ngoko");
});

test("attaches ordered meanings to the shared entry", () => {
  const { patterns } = buildDictionaryFromRows(vocabRows, meaningRows);
  const aba = patterns.find((p) => p.pattern === "aba")!;
  const dhawuh = patterns.find((p) => p.pattern === "dhawuh")!;
  expect(aba.entry.meanings).toEqual(["arahan", "instruksi"]);
  // both levels of the same vocab point to the same entry object
  expect(dhawuh.entry).toBe(aba.entry);
});

test("entry without meanings gets an empty array", () => {
  const { patterns } = buildDictionaryFromRows(
    [{ id: 9, ngoko: "sega", krama: "sekul", inggil: "sekul", type: "benda" }],
    []
  );
  expect(patterns[0]!.entry.meanings).toEqual([]);
});
