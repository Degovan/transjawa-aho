import type { Pool } from "mysql2/promise";
import { TARGET_LANG } from "../config/env";
import type { MeaningRow, VocabRow } from "./types";

/** All DB access for the dictionary lives here, isolated from the pure builder. */
export async function fetchDictionaryRows(
  pool: Pool,
  targetLang: string = TARGET_LANG
): Promise<{ vocabRows: VocabRow[]; meaningRows: MeaningRow[] }> {
  const conn = await pool.getConnection();
  try {
    const [langRows] = await conn.query("SELECT id FROM languages WHERE code = ?", [
      targetLang,
    ]);
    const targetLangId = (langRows as any[])[0]?.id;
    if (!targetLangId) {
      throw new Error(`Language code "${targetLang}" not found in languages table`);
    }

    const [vocabRows] = await conn.query(
      "SELECT id, ngoko, krama, inggil, type FROM vocabularies"
    );
    const [meaningRows] = await conn.query(
      "SELECT vocabulary_id, meaning FROM meanings WHERE language_id = ? ORDER BY vocabulary_id, `order`",
      [targetLangId]
    );

    return {
      vocabRows: vocabRows as VocabRow[],
      meaningRows: meaningRows as MeaningRow[],
    };
  } finally {
    conn.release();
  }
}
