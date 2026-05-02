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

    CREATE TABLE IF NOT EXISTS wishlists (
      user_id TEXT NOT NULL,
      item_name TEXT NOT NULL,
      added_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, item_name)
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

export const wishlists = {
  add(db: Db, userId: string, itemName: string) {
    db.prepare('INSERT OR IGNORE INTO wishlists (user_id, item_name) VALUES (?, ?)').run(userId, itemName.toLowerCase());
  },
  remove(db: Db, userId: string, itemName: string) {
    return db.prepare('DELETE FROM wishlists WHERE user_id = ? AND item_name = ?').run(userId, itemName.toLowerCase());
  },
  getForUser(db: Db, userId: string) {
    return db.prepare('SELECT item_name, added_at FROM wishlists WHERE user_id = ? ORDER BY added_at DESC').all(userId) as { item_name: string; added_at: number }[];
  },
  getUsersForItems(db: Db, itemNames: string[]) {
    if (itemNames.length === 0) return [];
    const shopNames = itemNames.map(n => n.toLowerCase());
    const all = db.prepare('SELECT user_id, item_name FROM wishlists').all() as { user_id: string; item_name: string }[];
    const matches: { user_id: string; item_name: string; matched_shop_name: string }[] = [];
    for (const row of all) {
      const wish = row.item_name.toLowerCase();
      for (const shop of shopNames) {
        if (shop === wish || shop.includes(wish) || wish.includes(shop)) {
          matches.push({ user_id: row.user_id, item_name: row.item_name, matched_shop_name: shop });
          break;
        }
      }
    }
    return matches;
  },
  clear(db: Db, userId: string) {
    db.prepare('DELETE FROM wishlists WHERE user_id = ?').run(userId);
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
