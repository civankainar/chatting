import sqlite3 from "sqlite3";
import { open } from "sqlite";

export async function getDb() {
  const db = await open({
    filename: "./chat.db",
    driver: sqlite3.Database,
  });
  await db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      username TEXT,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT,
      sender TEXT,           -- 'client' | 'admin'
      type TEXT,             -- 'text' | 'image' | 'audio'
      content TEXT,          -- metin veya dosya yolu
      ts INTEGER
    );
  `);
  return db;
}
