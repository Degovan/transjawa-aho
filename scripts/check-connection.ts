import { pool } from "../src/db/pool";

const conn = await pool.getConnection();
try {
  const [ver] = await conn.query("SELECT VERSION() AS version");
  const [tables] = await conn.query("SHOW TABLES");
  console.log("Connected to MySQL:", (ver as any)[0].version);
  console.log("Database:", process.env.DB_DATABASE);
  console.log("Tables:");
  for (const row of tables as any[]) {
    console.log("  -", Object.values(row)[0]);
  }
} finally {
  conn.release();
  await pool.end();
}
