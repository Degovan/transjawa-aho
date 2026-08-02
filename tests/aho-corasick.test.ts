import { test, expect } from "bun:test";
import { AhoCorasick } from "../src/matcher/aho-corasick";

test("finds single-token matches", () => {
  const ac = new AhoCorasick<string>();
  ac.add(["abang"], "merah");
  ac.build();
  const m = ac.search(["aku", "abang"]);
  expect(m).toHaveLength(1);
  expect(m[0]!.payload).toBe("merah");
  expect(m[0]!.start).toBe(1);
  expect(m[0]!.end).toBe(1);
});

test("does not match a pattern inside a longer token", () => {
  const ac = new AhoCorasick<string>();
  ac.add(["abang"], "merah");
  ac.build();
  // token-based: "sembarang" is one token, never matches "abang"
  expect(ac.search(["sembarang"])).toHaveLength(0);
});

test("matches multi-token phrases", () => {
  const ac = new AhoCorasick<string>();
  ac.add(["menanak", "nasi"], "cook rice");
  ac.build();
  const m = ac.search(["dia", "menanak", "nasi", "pagi"]);
  expect(m).toHaveLength(1);
  expect(m[0]!.payload).toBe("cook rice");
  expect(m[0]!.length).toBe(2);
  expect(m[0]!.start).toBe(1);
  expect(m[0]!.end).toBe(2);
});

test("reports overlapping patterns via fail links", () => {
  const ac = new AhoCorasick<string>();
  ac.add(["a", "b"], "ab");
  ac.add(["b"], "b");
  ac.build();
  const m = ac.search(["a", "b"]);
  const payloads = m.map((x) => x.payload).sort();
  expect(payloads).toEqual(["ab", "b"]);
});
