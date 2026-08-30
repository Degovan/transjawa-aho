import { test, expect } from "bun:test";
import { analyzeSuffix, applySuffix, SUFFIX_RULES } from "../src/matcher/affixes";

const known = (...stems: string[]) => (s: string) => stems.includes(s);

test("rules are ordered longest suffix first", () => {
  const lengths = SUFFIX_RULES.map((r) => r.suffix.length);
  expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
});

test("splits a known stem from its suffix", () => {
  const res = analyzeSuffix("agamanya", known("agama"));
  expect(res).not.toBeNull();
  expect(res!.stem).toBe("agama");
  expect(res!.rule.suffix).toBe("nya");
});

test("refuses to split when the leftover stem is not in the dictionary", () => {
  // "raya" ends with no rule suffix; "hanya" would leave "ha" which is unknown
  expect(analyzeSuffix("hanya", known("agama"))).toBeNull();
});

test("returns null for a token with no recognizable suffix", () => {
  expect(analyzeSuffix("agama", known("agama"))).toBeNull();
});

test("respects minStemLength", () => {
  // stem "a" is shorter than minStemLength even if somehow 'known'
  expect(analyzeSuffix("anya", known("a"))).toBeNull();
});

test("attaches -ne after a vowel and -e after a consonant (ngoko)", () => {
  const rule = SUFFIX_RULES.find((r) => r.suffix === "nya")!;
  expect(applySuffix("sega", rule, "ngoko")).toBe("segane");
  expect(applySuffix("omah", rule, "ngoko")).toBe("omahe");
});

test("attaches -nipun after a vowel and -ipun after a consonant (krama/inggil)", () => {
  const rule = SUFFIX_RULES.find((r) => r.suffix === "nya")!;
  expect(applySuffix("sekul", rule, "krama")).toBe("sekulipun");
  expect(applySuffix("sega", rule, "krama")).toBe("seganipun");
  expect(applySuffix("sekul", rule, "inggil")).toBe("sekulipun");
});

test("'-ku' is bound in ngoko but definite + free pronoun in krama/inggil", () => {
  const ku = SUFFIX_RULES.find((r) => r.suffix === "ku")!;
  expect(applySuffix("agama", ku, "ngoko")).toBe("agamaku");
  // krama has no bound 1st-person suffix: noun takes -nipun, "kula" follows
  expect(applySuffix("agami", ku, "krama")).toBe("agaminipun kula");
  expect(applySuffix("agami", ku, "inggil")).toBe("agaminipun kula");
  // consonant-final stem takes -ipun instead of -nipun
  expect(applySuffix("dalem", ku, "krama")).toBe("dalemipun kula");
});

test("'-mu' pronoun differs between krama (sampeyan) and inggil (panjenengan)", () => {
  const mu = SUFFIX_RULES.find((r) => r.suffix === "mu")!;
  expect(applySuffix("agama", mu, "ngoko")).toBe("agamamu");
  expect(applySuffix("agami", mu, "krama")).toBe("agaminipun sampeyan");
  expect(applySuffix("agami", mu, "inggil")).toBe("agaminipun panjenengan");
  expect(applySuffix("dalem", mu, "inggil")).toBe("dalemipun panjenengan");
});

test("'-ku' uses kula for both krama and inggil", () => {
  const ku = SUFFIX_RULES.find((r) => r.suffix === "ku")!;
  // unlike "-mu", the 1st-person pronoun does not escalate between the two
  expect(applySuffix("agami", ku, "krama")).toBe("agaminipun kula");
  expect(applySuffix("agami", ku, "inggil")).toBe("agaminipun kula");
});

test("returns null when the rule has no form for the requested level", () => {
  // every shipped rule covers all three levels, so use a rule with a gap
  const partial = {
    suffix: "xx",
    javanese: { ngoko: { afterVowel: "x", afterConsonant: "x" } },
    minStemLength: 2,
  };
  expect(applySuffix("sega", partial, "ngoko")).toBe("segax");
  expect(applySuffix("sega", partial, "krama")).toBeNull();
});
