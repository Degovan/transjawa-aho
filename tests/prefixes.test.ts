import { test, expect } from "bun:test";
import {
  analyzePrefix,
  applyPrefix,
  INDONESIAN_PREFIX_FORMS,
  INDONESIAN_PREFIX_REVERSALS,
  JAVANESE_PREFIX_FORMS,
  JAVANESE_PREFIX_REVERSALS,
} from "../src/matcher/prefixes";

const known = (...stems: string[]) => (s: string) => stems.includes(s);
const id = (stem: string) => applyPrefix(stem, INDONESIAN_PREFIX_FORMS);
const jv = (stem: string) => applyPrefix(stem, JAVANESE_PREFIX_FORMS);

// --- Indonesian meN-, per Chaer 2002 ---

test("me- before r, l, w, y and nasals", () => {
  expect(id("rawat")).toBe("merawat");
  expect(id("lihat")).toBe("melihat");
  expect(id("wasit")).toBe("mewasit");
  expect(id("makan")).toBe("memakan");
  expect(id("nanti")).toBe("menanti");
  expect(id("nganga")).toBe("menganga");
});

test("mem- before b, f, v", () => {
  expect(id("baca")).toBe("membaca");
  expect(id("fitnah")).toBe("memfitnah");
  expect(id("vaksin")).toBe("memvaksin");
});

test("men- before c, d, j", () => {
  expect(id("cuci")).toBe("mencuci");
  expect(id("duga")).toBe("menduga");
  expect(id("jaga")).toBe("menjaga");
});

test("meng- before vowels, g, h, kh", () => {
  expect(id("ambil")).toBe("mengambil");
  expect(id("inap")).toBe("menginap");
  expect(id("ukur")).toBe("mengukur");
  expect(id("goda")).toBe("menggoda");
  expect(id("hina")).toBe("menghina");
  expect(id("khayal")).toBe("mengkhayal");
});

test("k, t, s, p assimilate away", () => {
  expect(id("tulis")).toBe("menulis");
  expect(id("tolong")).toBe("menolong");
  expect(id("sikat")).toBe("menyikat");
  expect(id("pesona")).toBe("memesona");
  expect(id("konsumsi")).toBe("mengonsumsi");
});

test("a stem-initial consonant in a cluster survives", () => {
  // mem-proses, not mem-oses
  expect(id("proses")).toBe("memproses");
  expect(id("praktik")).toBe("mempraktik");
  expect(id("kritik")).toBe("mengkritik");
});

// --- Javanese ater-ater anuswara ---

test("m- keeps b but absorbs p and w", () => {
  expect(jv("buru")).toBe("mburu");
  expect(jv("babat")).toBe("mbabat");
  expect(jv("pangan")).toBe("mangan");
  expect(jv("wulang")).toBe("mulang");
  expect(jv("warung")).toBe("marung");
});

test("n- keeps d, dh, j but absorbs t, th", () => {
  expect(jv("dudut")).toBe("ndudut");
  expect(jv("dhupak")).toBe("ndhupak");
  expect(jv("jupuk")).toBe("njupuk");
  expect(jv("tulis")).toBe("nulis");
  expect(jv("tandur")).toBe("nandur");
});

test("ny- absorbs c and s", () => {
  expect(jv("cukil")).toBe("nyukil");
  expect(jv("caruk")).toBe("nyaruk");
});

test("ng- keeps vowels, g, r, l but absorbs k", () => {
  expect(jv("rasa")).toBe("ngrasa");
  expect(jv("rujak")).toBe("ngrujak");
  expect(jv("kuras")).toBe("nguras");
});

test("returns null for a stem no rule covers", () => {
  // "q" is not in any initials list
  expect(jv("qqq")).toBeNull();
});

// --- reverse: candidate generation ---

test("reverses an Indonesian prefix by restoring the deleted consonant", () => {
  const res = analyzePrefix("menulis", INDONESIAN_PREFIX_REVERSALS, known("tulis"));
  expect(res).not.toBeNull();
  expect(res!.stem).toBe("tulis");
  expect(res!.prefix).toBe("men");
});

test("reverses a Javanese prefix by restoring the deleted consonant", () => {
  expect(analyzePrefix("nulis", JAVANESE_PREFIX_REVERSALS, known("tulis"))!.stem).toBe("tulis");
  expect(analyzePrefix("mangan", JAVANESE_PREFIX_REVERSALS, known("pangan"))!.stem).toBe("pangan");
  expect(analyzePrefix("nguras", JAVANESE_PREFIX_REVERSALS, known("kuras"))!.stem).toBe("kuras");
  expect(analyzePrefix("nyukil", JAVANESE_PREFIX_REVERSALS, known("cukil"))!.stem).toBe("cukil");
});

test("reverses a non-assimilating prefix with nothing to restore", () => {
  expect(analyzePrefix("mengambil", INDONESIAN_PREFIX_REVERSALS, known("ambil"))!.stem).toBe(
    "ambil"
  );
  expect(analyzePrefix("membaca", INDONESIAN_PREFIX_REVERSALS, known("baca"))!.stem).toBe("baca");
  expect(analyzePrefix("njupuk", JAVANESE_PREFIX_REVERSALS, known("jupuk"))!.stem).toBe("jupuk");
  expect(analyzePrefix("ngrasa", JAVANESE_PREFIX_REVERSALS, known("rasa"))!.stem).toBe("rasa");
});

test("longest marker is tried first", () => {
  // "mengambil" must not be read as "me" + "ngambil"
  const res = analyzePrefix("mengambil", INDONESIAN_PREFIX_REVERSALS, known("ambil", "ngambil"));
  expect(res!.prefix).toBe("meng");
  expect(res!.stem).toBe("ambil");
});

test("the dictionary decides between ambiguous candidates", () => {
  // Only "ulis" is known, so that is what comes back
  expect(analyzePrefix("nulis", JAVANESE_PREFIX_REVERSALS, known("ulis"))!.stem).toBe("ulis");
  // Only "tulis" is known
  expect(analyzePrefix("nulis", JAVANESE_PREFIX_REVERSALS, known("tulis"))!.stem).toBe("tulis");
  // Both known: the restoring candidate wins, being the longer reading
  expect(analyzePrefix("nulis", JAVANESE_PREFIX_REVERSALS, known("ulis", "tulis"))!.stem).toBe(
    "tulis"
  );
});

test("returns null when no candidate stem is in the dictionary", () => {
  expect(analyzePrefix("menggoreng", INDONESIAN_PREFIX_REVERSALS, known("tulis"))).toBeNull();
  expect(analyzePrefix("ngoyak", JAVANESE_PREFIX_REVERSALS, known("tulis"))).toBeNull();
});

test("does not treat a bare word as prefixed", () => {
  // "meja" starts with "me" but "ja" is not a dictionary stem
  expect(analyzePrefix("meja", INDONESIAN_PREFIX_REVERSALS, known("meja"))).toBeNull();
});

test("round trip: apply then reverse returns the original stem", () => {
  for (const stem of ["tulis", "baca", "ambil", "sikat", "pesona", "goda", "cuci"]) {
    const surface = id(stem)!;
    expect(analyzePrefix(surface, INDONESIAN_PREFIX_REVERSALS, known(stem))!.stem).toBe(stem);
  }
  for (const stem of ["tulis", "pangan", "kuras", "rasa", "jupuk", "cukil", "buru"]) {
    const surface = jv(stem)!;
    expect(analyzePrefix(surface, JAVANESE_PREFIX_REVERSALS, known(stem))!.stem).toBe(stem);
  }
});
