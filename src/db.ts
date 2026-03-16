import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type Db = Database.Database;

export function openDb(dbPath: string): Db {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS feeds (
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, channel_id)
    );

    CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      hash TEXT NOT NULL
    );
  `);
  return db;
}

export const feeds = {
  add(db: Db, guildId: string, channelId: string) {
    db.prepare('INSERT OR IGNORE INTO feeds (guild_id, channel_id) VALUES (?, ?)').run(guildId, channelId);
  },
  remove(db: Db, guildId: string, channelId: string) {
    db.prepare('DELETE FROM feeds WHERE guild_id = ? AND channel_id = ?').run(guildId, channelId);
  },
  getAll(db: Db) {
    return db.prepare('SELECT * FROM feeds').all() as { guild_id: string; channel_id: string }[];
  },
  getForGuild(db: Db, guildId: string) {
    return db.prepare('SELECT * FROM feeds WHERE guild_id = ?').all(guildId) as { guild_id: string; channel_id: string }[];
  }
};

export const state = {
  getHash(db: Db, key: string): string | null {
    const row = db.prepare('SELECT hash FROM state WHERE key = ?').get(key) as { hash: string } | undefined;
    return row?.hash ?? null;
  },
  setHash(db: Db, key: string, hash: string) {
    db.prepare('INSERT INTO state (key, hash) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET hash=excluded.hash').run(key, hash);
  }
};
