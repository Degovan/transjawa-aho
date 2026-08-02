import { loadDictionary } from "../src/dictionary";
import { pool } from "../src/db/pool";

const dict = await loadDictionary();

console.log("Total patterns:", dict.patterns.length);

console.log("\nSample patterns:");
for (const p of dict.patterns.slice(0, 8)) {
  console.log(
    `  "${p.pattern}" [${p.level}] type=${p.entry.type} -> ${p.entry.meanings.join(", ")}`
  );
}

await pool.end();
