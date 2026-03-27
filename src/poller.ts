import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import { createHash } from 'crypto';
import { feeds, state, wishlists, type Db } from './db.js';

const REPO = 'Fortnite-Datamining/Fortnite-Datamining';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main/data`;
const POLL_INTERVAL = 5 * 60 * 1000;

function hash(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

async function fetchJSON<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'FortniteDataminingBot/1.0', 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

function rarityColor(rarity?: string): number {
  const r = (rarity ?? '').toLowerCase();
  if (r.includes('legendary')) return 0xf0b132;
  if (r.includes('epic')) return 0xb94fe0;
  if (r.includes('rare')) return 0x3f9fe0;
  if (r.includes('uncommon')) return 0x60aa3a;
  if (r.includes('common')) return 0x8c8c8c;
  if (r.includes('mythic')) return 0xffd700;
  if (r.includes('marvel')) return 0xed1d24;
  if (r.includes('dc')) return 0x0078f0;
  if (r.includes('icon')) return 0x00cccc;
  if (r.includes('star wars')) return 0xffe81f;
  if (r.includes('gaming')) return 0x7c5ff5;
  if (r.includes('lego')) return 0xffd500;
  return 0x00b2ff;
}

function rarityEmoji(rarity?: string): string {
  const r = (rarity ?? '').toLowerCase();
  if (r.includes('legendary')) return '🟠';
  if (r.includes('epic')) return '🟣';
  if (r.includes('rare')) return '🔵';
  if (r.includes('uncommon')) return '🟢';
  if (r.includes('mythic')) return '🟡';
  if (r.includes('marvel') || r.includes('dc') || r.includes('icon') || r.includes('star wars') || r.includes('gaming')) return '⭐';
  return '⚪';
}

async function sendToFeeds(client: Client, db: Db, embeds: EmbedBuilder[], content?: string) {
  const allFeeds = feeds.getAll(db);
  if (allFeeds.length === 0) return;

  for (const feed of allFeeds) {
    try {
      const channel = await client.channels.fetch(feed.channel_id);
      if (!channel || !(channel instanceof TextChannel)) continue;

      for (let i = 0; i < embeds.length; i += 10) {
        const batch = embeds.slice(i, i + 10);
        await channel.send({ content: i === 0 ? content : undefined, embeds: batch });
      }
    } catch (err) {
      console.warn(`Failed to post to ${feed.channel_id}: ${err}`);
    }
  }
}

// ─── Build / Game Update ─────────────────────────────────────────

interface BuildInfo {
  build: string;
  version: string | null;
}

async function checkBuild(client: Client, db: Db) {
  const data = await fetchJSON<BuildInfo>(`${RAW_BASE}/meta/build_info.json`);
  if (!data?.build) return;

  const currentHash = hash(data.build);
  const oldHash = state.getHash(db, 'build');
  if (oldHash === currentHash) return;

  if (oldHash) {
    const versionMatch = data.build.match(/Release-([\d.]+)/);
    const version = versionMatch?.[1] ?? 'Unknown';

    await sendToFeeds(client, db, [
      new EmbedBuilder()
        .setTitle(`🚨 Fortnite v${version} Update Detected!`)
        .setDescription(
          `A new Fortnite update has just been pushed!\n\n` +
          `**What this means:**\n` +
          `• New skins, items, and cosmetics may have been added to the files\n` +
          `• Map changes could be incoming\n` +
          `• New gamemodes or weapons might be on the way\n` +
          `• Check back soon — we'll post everything we find!`
        )
        .addFields({ name: 'Version', value: `v${version}`, inline: true })
        .setColor(0xe74c3c)
        .setTimestamp()
        .setFooter({ text: 'Fortnite Datamining Updates' })
    ]);
  }

  state.setHash(db, 'build', currentHash);
}

// ─── BR Cosmetics ────────────────────────────────────────────────

interface CosmeticItem {
  id: string;
  name: string;
  description: string;
  type?: { displayValue: string };
  rarity?: { displayValue: string };
  series?: { value: string };
  introduction?: { text: string; chapter?: string; season?: string };
  images?: { icon?: string; featured?: string; smallIcon?: string };
  set?: { value: string; text?: string };
  variants?: { channel: string; type: string; options: { name: string; image?: string }[] }[];
}

async function checkCosmetics(client: Client, db: Db) {
  const raw = await fetchJSON<{ data: CosmeticItem[] }>(`${RAW_BASE}/cosmetics/br.json`);
  if (!raw?.data) return;
  const data = raw.data;

  const ids = data.map((i) => i.id).sort();
  const currentHash = hash(JSON.stringify(ids));
  const oldHash = state.getHash(db, 'cosmetics_br');
  if (oldHash === currentHash) return;

  if (oldHash) {
    const oldIdsRaw = state.getHash(db, 'cosmetics_br_ids');
    const oldIds = new Set(oldIdsRaw ? JSON.parse(oldIdsRaw) as string[] : []);
    const newItems = data.filter((item) => !oldIds.has(item.id));

    if (newItems.length > 0 && newItems.length <= 80) {
      const embeds: EmbedBuilder[] = [];

      const byType = new Map<string, CosmeticItem[]>();
      for (const item of newItems) {
        const type = item.type?.displayValue ?? 'Other';
        if (!byType.has(type)) byType.set(type, []);
        byType.get(type)!.push(item);
      }

      const typeSummary = [...byType.entries()]
        .map(([type, items]) => `• **${items.length}** ${type}${items.length === 1 ? '' : 's'}`)
        .join('\n');

      embeds.push(
        new EmbedBuilder()
          .setTitle(`🆕 ${newItems.length} New Cosmetics Found!`)
          .setDescription(
            `New items have been added to the game files — these are **unreleased** and could appear in the shop soon!\n\n` +
            `**Breakdown:**\n${typeSummary}`
          )
          .setColor(0x00b2ff)
          .setTimestamp()
          .setFooter({ text: 'Fortnite Datamining Updates' })
      );

      for (const item of newItems.slice(0, 20)) {
        const embed = new EmbedBuilder()
          .setTitle(`${rarityEmoji(item.rarity?.displayValue)} ${item.name}`)
          .setColor(rarityColor(item.rarity?.displayValue));

        const desc: string[] = [];
        if (item.description) desc.push(`*"${item.description}"*`);
        desc.push('');
        if (item.type?.displayValue) desc.push(`**Type:** ${item.type.displayValue}`);
        if (item.rarity?.displayValue) desc.push(`**Rarity:** ${item.rarity.displayValue}`);
        if (item.set?.value) desc.push(`**Set:** ${item.set.value}`);
        if (item.introduction?.text) desc.push(`**${item.introduction.text}**`);
        if (item.variants && item.variants.length > 0) {
          const styleCount = item.variants.reduce((sum, v) => sum + v.options.length, 0);
          desc.push(`**Styles:** ${styleCount} variant${styleCount === 1 ? '' : 's'} available`);
        }

        embed.setDescription(desc.join('\n'));

        const featured = item.images?.featured;
        const icon = item.images?.icon ?? item.images?.smallIcon;
        if (featured && item.type?.displayValue === 'Outfit') {
          embed.setImage(featured);
        } else if (icon) {
          embed.setThumbnail(icon);
        }

        embeds.push(embed);
      }

      if (newItems.length > 20) {
        embeds.push(
          new EmbedBuilder()
            .setDescription(`...and **${newItems.length - 20}** more items! View the full list on [GitHub](https://github.com/${REPO}).`)
            .setColor(0x00b2ff)
        );
      }

      await sendToFeeds(client, db, embeds);
    }
  }

  state.setHash(db, 'cosmetics_br', currentHash);
  state.setHash(db, 'cosmetics_br_ids', JSON.stringify(ids));
}

// ─── Item Shop ───────────────────────────────────────────────────

interface ShopData {
  data: {
    date: string;
    entries: {
      brItems?: {
        id: string;
        name: string;
        description: string;
        type?: { displayValue: string };
        rarity?: { displayValue: string };
        images?: { icon?: string; featured?: string };
        set?: { value: string };
      }[];
      finalPrice: number;
      regularPrice: number;
      bundle?: { name: string };
      giftable: boolean;
    }[];
  };
}

async function checkShop(client: Client, db: Db) {
  const data = await fetchJSON<ShopData>(`${RAW_BASE}/shop/current.json`);
  if (!data?.data?.entries) return;

  const currentHash = hash(data.data.date ?? JSON.stringify(data.data.entries.map((e) => e.brItems?.map((i) => i.id)).flat().sort()));
  const oldHash = state.getHash(db, 'shop');
  if (oldHash === currentHash) return;
  state.setHash(db, 'shop', currentHash);
  if (!oldHash) return;

  const embeds: EmbedBuilder[] = [];

  const seenNames = new Set<string>();
  const items: { name: string; price: number; regularPrice: number; rarity: string; type: string; giftable: boolean }[] = [];

  for (const entry of data.data.entries) {
    const item = entry.brItems?.[0];
    if (!item) continue;
    const name = entry.bundle?.name ?? item.name;
    if (!name || seenNames.has(name)) continue;
    seenNames.add(name);
    items.push({
      name,
      price: entry.finalPrice,
      regularPrice: entry.regularPrice,
      rarity: item.rarity?.displayValue ?? 'Unknown',
      type: item.type?.displayValue ?? '',
      giftable: entry.giftable
    });
  }

  const date = new Date(data.data.date);
  const dateStr = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  embeds.push(
    new EmbedBuilder()
      .setTitle(`🛒 Item Shop — ${dateStr}`)
      .setDescription(`The Item Shop has reset! Here's everything available today:\n\n**${items.length} items** in today's shop`)
      .setColor(0x2ecc71)
      .setTimestamp()
  );

  const lines: string[] = [];
  for (const item of items) {
    const emoji = rarityEmoji(item.rarity);
    const sale = item.regularPrice > item.price ? ` ~~${item.regularPrice.toLocaleString()}~~ **SALE!**` : '';
    const gift = item.giftable ? ' 🎁' : '';
    lines.push(`${emoji} **${item.name}** — ${item.price.toLocaleString()} V-Bucks${sale}${gift}\n> ${item.rarity} ${item.type}`);
  }

  for (let i = 0; i < Math.min(lines.length, 40); i += 8) {
    const chunk = lines.slice(i, i + 8);
    embeds.push(
      new EmbedBuilder()
        .setDescription(chunk.join('\n\n'))
        .setColor(0x2ecc71)
    );
  }

  if (items.length > 40) {
    embeds.push(
      new EmbedBuilder()
        .setDescription(`...and **${items.length - 40}** more items in the shop!`)
        .setColor(0x2ecc71)
    );
  }

  embeds[embeds.length - 1].setFooter({ text: '🎁 = Giftable • Fortnite Datamining Updates' });

  await sendToFeeds(client, db, embeds);

  // Wishlist DM notifications
  const shopItemNames = [...seenNames].map(n => n.toLowerCase());
  const matches = wishlists.getUsersForItems(db, shopItemNames);

  const byUser = new Map<string, string[]>();
  for (const m of matches) {
    if (!byUser.has(m.user_id)) byUser.set(m.user_id, []);
    byUser.get(m.user_id)!.push(m.item_name);
  }

  for (const [userId, skins] of byUser) {
    try {
      const user = await client.users.fetch(userId);
      const skinList = skins.map(s => `• **${s}**`).join('\n');
      await user.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('🔔 Wishlist Alert — Item Shop!')
            .setDescription(`Skins from your wishlist are in the Item Shop right now!\n\n${skinList}\n\nGo grab them before they're gone!`)
            .setColor(0x2ecc71)
            .setTimestamp()
            .setFooter({ text: 'Fortnite Datamining Updates • /unnotify to stop' })
        ]
      });
    } catch {
      // DMs closed or user not found
    }
  }
}

// ─── News ────────────────────────────────────────────────────────

interface NewsData {
  data: {
    br?: { motds?: { id: string; title: string; body: string; image: string }[] };
    stw?: { motds?: { id: string; title: string; body: string; image: string }[] };
  };
}

async function checkNews(client: Client, db: Db) {
  const data = await fetchJSON<NewsData>(`${RAW_BASE}/news/current.json`);
  if (!data?.data) return;

  const motds = [...(data.data.br?.motds ?? []), ...(data.data.stw?.motds ?? [])];
  const currentHash = hash(JSON.stringify(motds.map((m) => m.id).sort()));
  const oldHash = state.getHash(db, 'news');
  if (oldHash === currentHash) return;

  if (oldHash) {
    const oldIdsRaw = state.getHash(db, 'news_ids');
    const oldIds = new Set(oldIdsRaw ? JSON.parse(oldIdsRaw) as string[] : []);
    const newMotds = motds.filter((m) => !oldIds.has(m.id));

    if (newMotds.length > 0 && newMotds.length <= 10) {
      const embeds: EmbedBuilder[] = [];

      embeds.push(
        new EmbedBuilder()
          .setTitle('📰 New In-Game News!')
          .setDescription('Epic Games just posted new announcements:')
          .setColor(0xe67e22)
          .setTimestamp()
      );

      for (const motd of newMotds.slice(0, 9)) {
        const embed = new EmbedBuilder()
          .setTitle(motd.title || 'News Update')
          .setDescription(motd.body || 'No details available')
          .setColor(0xe67e22);
        if (motd.image) embed.setImage(motd.image);
        embed.setFooter({ text: 'Fortnite Datamining Updates' });
        embeds.push(embed);
      }

      await sendToFeeds(client, db, embeds);
    }
  }

  state.setHash(db, 'news', currentHash);
  state.setHash(db, 'news_ids', JSON.stringify(motds.map((m) => m.id).sort()));
}

// ─── Playlists / Gamemodes ───────────────────────────────────────

interface PlaylistItem {
  id: string;
  name: string;
  description: string;
  isLimitedTimeMode?: boolean;
  maxPlayers?: number;
  maxSquadSize?: number;
}

async function checkPlaylists(client: Client, db: Db) {
  const raw = await fetchJSON<{ data: PlaylistItem[] }>(`${RAW_BASE}/playlists/current.json`);
  if (!raw?.data) return;
  const data = raw.data;

  const ids = data.map((p) => p.id).sort();
  const currentHash = hash(JSON.stringify(ids));
  const oldHash = state.getHash(db, 'playlists');
  if (oldHash === currentHash) return;

  if (oldHash) {
    const oldIdsRaw = state.getHash(db, 'playlists_ids');
    const oldIds = new Set(oldIdsRaw ? JSON.parse(oldIdsRaw) as string[] : []);
    const newPlaylists = data.filter((p) => !oldIds.has(p.id));

    if (newPlaylists.length > 0 && newPlaylists.length <= 20) {
      const lines = newPlaylists.map((p) => {
        const name = p.name || p.id;
        const desc = p.description || 'No description yet';
        const ltm = p.isLimitedTimeMode ? ' **(LTM)**' : '';
        const players = p.maxPlayers ? ` • Up to ${p.maxPlayers} players` : '';
        const squad = p.maxSquadSize && p.maxSquadSize > 1 ? ` • Squads of ${p.maxSquadSize}` : '';
        return `🎮 **${name}**${ltm}\n> ${desc}${players}${squad}`;
      });

      await sendToFeeds(client, db, [
        new EmbedBuilder()
          .setTitle(`🎮 ${newPlaylists.length} New Gamemode${newPlaylists.length === 1 ? '' : 's'} Detected!`)
          .setDescription(
            `New gamemodes have been added to the files:\n\n${lines.slice(0, 10).join('\n\n')}`
          )
          .setColor(0x9b59b6)
          .setTimestamp()
          .setFooter({ text: 'Fortnite Datamining Updates' })
      ]);
    }
  }

  state.setHash(db, 'playlists', currentHash);
  state.setHash(db, 'playlists_ids', JSON.stringify(ids));
}

// ─── Jam Tracks (Festival) ───────────────────────────────────────

interface JamTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  releaseYear?: number;
  duration?: number;
  genres?: string[];
}

async function checkTracks(client: Client, db: Db) {
  const raw = await fetchJSON<{ data: JamTrack[] }>(`${RAW_BASE}/cosmetics/tracks.json`);
  if (!raw?.data) return;
  const data = raw.data;

  const ids = data.map((t) => t.id).sort();
  const currentHash = hash(JSON.stringify(ids));
  const oldHash = state.getHash(db, 'tracks');
  if (oldHash === currentHash) return;

  if (oldHash) {
    const oldIdsRaw = state.getHash(db, 'tracks_ids');
    const oldIds = new Set(oldIdsRaw ? JSON.parse(oldIdsRaw) as string[] : []);
    const newTracks = data.filter((t) => !oldIds.has(t.id));

    if (newTracks.length > 0 && newTracks.length <= 30) {
      const lines = newTracks.map((t) => {
        const duration = t.duration ? `${Math.floor(t.duration / 60)}:${String(t.duration % 60).padStart(2, '0')}` : '';
        const genre = t.genres?.join(', ') ?? '';
        return `🎵 **${t.title}** by **${t.artist}**\n> ${genre}${duration ? ` • ${duration}` : ''}${t.releaseYear ? ` • ${t.releaseYear}` : ''}`;
      });

      await sendToFeeds(client, db, [
        new EmbedBuilder()
          .setTitle(`🎵 ${newTracks.length} New Jam Track${newTracks.length === 1 ? '' : 's'} Found!`)
          .setDescription(
            `New songs are coming to Fortnite Festival:\n\n${lines.slice(0, 10).join('\n\n')}`
          )
          .setColor(0x1db954)
          .setTimestamp()
          .setFooter({ text: 'Fortnite Datamining Updates' })
      ]);
    }
  }

  state.setHash(db, 'tracks', currentHash);
  state.setHash(db, 'tracks_ids', JSON.stringify(ids));
}

// ─── LEGO Cosmetics ─────────────────────────────────────────────

interface LegoItem {
  id: string;
  cosmeticId?: string;
  images?: { large?: string; small?: string };
}

async function checkLego(client: Client, db: Db) {
  const raw = await fetchJSON<{ data: LegoItem[] }>(`${RAW_BASE}/cosmetics/lego.json`);
  if (!raw?.data) return;
  const data = raw.data;

  const ids = data.map((i) => i.id).sort();
  const currentHash = hash(JSON.stringify(ids));
  const oldHash = state.getHash(db, 'lego');
  if (oldHash === currentHash) return;

  if (oldHash) {
    const oldIdsRaw = state.getHash(db, 'lego_ids');
    const oldIds = new Set(oldIdsRaw ? JSON.parse(oldIdsRaw) as string[] : []);
    const newItems = data.filter((i) => !oldIds.has(i.id));

    if (newItems.length > 0 && newItems.length <= 30) {
      const embeds: EmbedBuilder[] = [
        new EmbedBuilder()
          .setTitle(`🧱 ${newItems.length} New LEGO Skin${newItems.length === 1 ? '' : 's'} Found!`)
          .setDescription(`New LEGO styles have been added to the game files. These skins will be available in LEGO Fortnite!`)
          .setColor(0xffd500)
          .setTimestamp()
          .setFooter({ text: 'Fortnite Datamining Updates' })
      ];

      for (const item of newItems.slice(0, 5)) {
        const img = item.images?.large ?? item.images?.small;
        if (img) {
          embeds.push(
            new EmbedBuilder().setImage(img).setColor(0xffd500)
          );
        }
      }

      await sendToFeeds(client, db, embeds);
    }
  }

  state.setHash(db, 'lego', currentHash);
  state.setHash(db, 'lego_ids', JSON.stringify(ids));
}

// ─── Cars / Vehicles ────────────────────────────────────────────

interface CarItem {
  id: string;
  name: string;
  description?: string;
}

async function checkCars(client: Client, db: Db) {
  const raw = await fetchJSON<{ data: CarItem[] }>(`${RAW_BASE}/cosmetics/cars.json`);
  if (!raw?.data) return;
  const data = raw.data;

  const ids = data.map((i) => i.id).sort();
  const currentHash = hash(JSON.stringify(ids));
  const oldHash = state.getHash(db, 'cars');
  if (oldHash === currentHash) return;

  if (oldHash) {
    const oldIdsRaw = state.getHash(db, 'cars_ids');
    const oldIds = new Set(oldIdsRaw ? JSON.parse(oldIdsRaw) as string[] : []);
    const newItems = data.filter((i) => !oldIds.has(i.id));

    if (newItems.length > 0 && newItems.length <= 20) {
      const lines = newItems.map((c) => `🚗 **${c.name}**${c.description ? `\n> ${c.description}` : ''}`);

      await sendToFeeds(client, db, [
        new EmbedBuilder()
          .setTitle(`🚗 ${newItems.length} New Vehicle${newItems.length === 1 ? '' : 's'} Found!`)
          .setDescription(`New vehicles have been added to the files:\n\n${lines.slice(0, 10).join('\n\n')}`)
          .setColor(0x3498db)
          .setTimestamp()
          .setFooter({ text: 'Fortnite Datamining Updates' })
      ]);
    }
  }

  state.setHash(db, 'cars', currentHash);
  state.setHash(db, 'cars_ids', JSON.stringify(ids));
}

// ─── Instruments (Festival) ─────────────────────────────────────

interface InstrumentItem {
  id: string;
  name: string;
  description?: string;
  rarity?: { displayValue: string };
}

async function checkInstruments(client: Client, db: Db) {
  const raw = await fetchJSON<{ data: InstrumentItem[] }>(`${RAW_BASE}/cosmetics/instruments.json`);
  if (!raw?.data) return;
  const data = raw.data;

  const ids = data.map((i) => i.id).sort();
  const currentHash = hash(JSON.stringify(ids));
  const oldHash = state.getHash(db, 'instruments');
  if (oldHash === currentHash) return;

  if (oldHash) {
    const oldIdsRaw = state.getHash(db, 'instruments_ids');
    const oldIds = new Set(oldIdsRaw ? JSON.parse(oldIdsRaw) as string[] : []);
    const newItems = data.filter((i) => !oldIds.has(i.id));

    if (newItems.length > 0 && newItems.length <= 20) {
      const lines = newItems.map((i) => {
        const rarity = i.rarity?.displayValue ?? '';
        return `🎸 **${i.name}**${rarity ? ` • ${rarity}` : ''}${i.description ? `\n> ${i.description}` : ''}`;
      });

      await sendToFeeds(client, db, [
        new EmbedBuilder()
          .setTitle(`🎸 ${newItems.length} New Instrument${newItems.length === 1 ? '' : 's'} Found!`)
          .setDescription(`New Festival instruments have been added:\n\n${lines.slice(0, 10).join('\n\n')}`)
          .setColor(0xe91e63)
          .setTimestamp()
          .setFooter({ text: 'Fortnite Datamining Updates' })
      ]);
    }
  }

  state.setHash(db, 'instruments', currentHash);
  state.setHash(db, 'instruments_ids', JSON.stringify(ids));
}

// ─── Banners ─────────────────────────────────────────────────────

interface BannerItem {
  id: string;
  name: string;
  description?: string;
}

async function checkBanners(client: Client, db: Db) {
  const raw = await fetchJSON<{ data: BannerItem[] }>(`${RAW_BASE}/banners/current.json`);
  if (!raw?.data) return;
  const data = raw.data;

  const ids = data.map((i) => i.id).sort();
  const currentHash = hash(JSON.stringify(ids));
  const oldHash = state.getHash(db, 'banners');
  if (oldHash === currentHash) return;

  if (oldHash) {
    const oldIdsRaw = state.getHash(db, 'banners_ids');
    const oldIds = new Set(oldIdsRaw ? JSON.parse(oldIdsRaw) as string[] : []);
    const newItems = data.filter((i) => !oldIds.has(i.id));

    if (newItems.length > 0 && newItems.length <= 30) {
      await sendToFeeds(client, db, [
        new EmbedBuilder()
          .setTitle(`🏳️ ${newItems.length} New Banner${newItems.length === 1 ? '' : 's'} Found!`)
          .setDescription(
            `New banners have been added to the files:\n\n` +
            newItems.slice(0, 15).map((b) => `• **${b.name || b.id}**${b.description ? ` — ${b.description}` : ''}`).join('\n')
          )
          .setColor(0x1abc9c)
          .setTimestamp()
          .setFooter({ text: 'Fortnite Datamining Updates' })
      ]);
    }
  }

  state.setHash(db, 'banners', currentHash);
  state.setHash(db, 'banners_ids', JSON.stringify(ids));
}

// ─── Poller ──────────────────────────────────────────────────────

let pollTimer: ReturnType<typeof setInterval> | null = null;

export function startPoller(client: Client, db: Db) {
  if (pollTimer) return;

  console.log('[Poller] Started — watching GitHub repo every 5 min');

  const poll = async () => {
    const allFeeds = feeds.getAll(db);
    if (allFeeds.length === 0) {
      console.log('[Poller] No feeds configured — skipping. Use /setup to add a channel.');
      return;
    }

    console.log(`[Poller] Checking for changes... (${allFeeds.length} feed${allFeeds.length === 1 ? '' : 's'} configured)`);

    try {
      const results = await Promise.allSettled([
        checkBuild(client, db),
        checkCosmetics(client, db),
        checkShop(client, db),
        checkNews(client, db),
        checkPlaylists(client, db),
        checkTracks(client, db),
        checkLego(client, db),
        checkCars(client, db),
        checkInstruments(client, db),
        checkBanners(client, db)
      ]);

      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        for (const f of failed) console.warn(`[Poller] Check failed:`, (f as PromiseRejectedResult).reason);
      }

      console.log(`[Poller] Done. ${failed.length > 0 ? `${failed.length} check(s) failed.` : 'All checks passed.'}`);
    } catch (err) {
      console.warn(`[Poller] Error: ${err}`);
    }
  };

  setTimeout(() => {
    poll();
    pollTimer = setInterval(poll, POLL_INTERVAL);
  }, 10_000);
}
