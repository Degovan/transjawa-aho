import { test, expect } from "bun:test";
import { normalize } from "../src/dictionary/normalize";

test("lowercases input", () => {
  expect(normalize("ABANG")).toBe("abang");
});

test("trims and collapses internal whitespace", () => {
  expect(normalize("  menanak   nasi  ")).toBe("menanak nasi");
});

test("collapses tabs and newlines to single space", () => {
  expect(normalize("adang\t\nsega")).toBe("adang sega");
});
