import { test, expect } from "bun:test";
import { Translator } from "../src/matcher/translator";
import { MAX_AFFIX_LOOKAHEAD } from "../src/matcher/affixes";
import type { DictPattern, ReversePattern, VocabEntry } from "../src/dictionary/types";

/**
 * Guards against accidentally reintroducing quadratic behaviour in the
 * translate path. These assert on SCALING, not absolute milliseconds, so they
 * stay meaningful on slower CI machines: doubling the input must not much more
 * than double the time.
 */

function buildDict(vocabCount: number, synonymBuckets = 0) {
  const patterns: DictPattern[] = [];
  const reversePatterns: ReversePattern[] = [];
  for (let i = 0; i < vocabCount; i++) {
    const entry: VocabEntry = {
      vocabularyId: i,
      type: null,
      levels: { ngoko: `n${i}`, krama: `k${i}`, inggil: `k${i}` },
      meanings: [synonymBuckets ? `syn${i % synonymBuckets}` : `m${i}`],
    };
    patterns.push({ pattern: `n${i}`, level: "ngoko", entry });
    reversePatterns.push({ pattern: entry.meanings[0]!, entry });
  }
  return { patterns, reversePatterns };
}

function measure(fn: () => void, iters: number): number {
  for (let i = 0; i < 3; i++) fn(); // warm up the JIT
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  return (performance.now() - t0) / iters;
}

/**
 * Time `build(n)` at n and 2n, returning the ratio. Repeats a few times and
 * keeps the best (lowest) ratio, since a single sample is easily skewed by GC
 * or scheduler noise.
 */
function scalingRatio(build: (n: number) => () => void, n: number, iters: number): number {
  let best = Infinity;
  for (let attempt = 0; attempt < 5; attempt++) {
    const small = measure(build(n), iters);
    const large = measure(build(n * 2), iters);
    if (small > 0) best = Math.min(best, large / small);
  }
  return best;
}

// Linear is 2.0x. Allow generous headroom for noise while still catching
// quadratic growth, which would land at ~4x.
const LINEAR_CEILING = 3.0;

test("id-jv scales linearly with input length", () => {
  const t = new Translator(buildDict(2000));
  const ratio = scalingRatio(
    (n) => {
      const text = Array.from({ length: n }, (_, i) => `m${(i * 7) % 2000}`).join(" ");
      return () => t.translate(text, { direction: "id-jv", level: "krama" });
    },
    400,
    10
  );
  expect(ratio).toBeLessThan(LINEAR_CEILING);
});

test("jv-id scales linearly with input length", () => {
  const t = new Translator(buildDict(2000));
  const ratio = scalingRatio(
    (n) => {
      const text = Array.from({ length: n }, (_, i) => `n${(i * 7) % 2000}`).join(" ");
      return () => t.translate(text);
    },
    400,
    10
  );
  expect(ratio).toBeLessThan(LINEAR_CEILING);
});

test("jv-id affix pass scales linearly when every token is affixed", () => {
  // Worst case for the affix pass: no plain match, every token needs analysis
  // plus a lookahead. A full-remainder slice per token would show up as ~4x.
  const t = new Translator(buildDict(2000));
  const ratio = scalingRatio(
    (n) => {
      const text = Array.from({ length: n }, (_, i) => `n${i % 2000}e`).join(" ");
      return () => t.translate(text);
    },
    400,
    10
  );
  expect(ratio).toBeLessThan(LINEAR_CEILING);
});

test("id-jv scales linearly on synonym-heavy input", () => {
  // Many entries share one meaning, so every span carries a long synonym list.
  // Re-scanning all matches per match would show up as ~4x here.
  const t = new Translator(buildDict(2000, 10));
  const ratio = scalingRatio(
    (n) => {
      const text = Array.from({ length: n }, (_, i) => `syn${i % 10}`).join(" ");
      return () => t.translate(text, { direction: "id-jv", level: "ngoko" });
    },
    200,
    10
  );
  expect(ratio).toBeLessThan(LINEAR_CEILING);
});

test("affix lookahead is bounded by the rule table, not the input", () => {
  // The jv -> id pass must only look at as many following words as the longest
  // affix form needs. If this grows unexpectedly, the lookahead bound is wrong.
  expect(MAX_AFFIX_LOOKAHEAD).toBeGreaterThanOrEqual(1);
  expect(MAX_AFFIX_LOOKAHEAD).toBeLessThanOrEqual(3);
});
