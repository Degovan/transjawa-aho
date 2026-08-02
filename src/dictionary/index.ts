import type { Pool } from "mysql2/promise";
import { pool as defaultPool } from "../db/pool";
import { fetchDictionaryRows } from "./repository";
import { buildDictionaryFromRows } from "./builder";
import type { Dictionary } from "./types";

export * from "./types";
export { normalize } from "./normalize";
export { buildDictionaryFromRows } from "./builder";
export { fetchDictionaryRows } from "./repository";

/** Load rows from the database and build the dictionary. */
export async function loadDictionary(pool: Pool = defaultPool): Promise<Dictionary> {
  const { vocabRows, meaningRows } = await fetchDictionaryRows(pool);
  return buildDictionaryFromRows(vocabRows, meaningRows);
}
