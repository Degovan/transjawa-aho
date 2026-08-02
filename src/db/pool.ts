import mysql from "mysql2/promise";
import { dbConfig } from "../config/env";

export const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
});
