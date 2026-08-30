import { loadDictionary } from "../src/dictionary";
import { pool } from "../src/db/pool";

const dict = await loadDictionary();

console.log("Total patterns (jv -> id):", dict.patterns.length);

console.log("\nSample patterns:");
for (const p of dict.patterns.slice(0, 8)) {
  console.log(
    `  "${p.pattern}" [${p.level}] type=${p.entry.type} -> ${p.entry.meanings.join(", ")}`
  );
}

console.log("\nTotal reverse patterns (id -> jv):", dict.reversePatterns?.length ?? 0);

console.log("\nSample reverse patterns:");
for (const p of (dict.reversePatterns ?? []).slice(0, 8)) {
  console.log(`  "${p.pattern}" -> ngoko=${p.entry.levels.ngoko} krama=${p.entry.levels.krama}`);
}

await pool.end();
