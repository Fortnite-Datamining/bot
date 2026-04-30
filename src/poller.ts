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

function chunkLines(lines: string[], maxChars = 3900): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    if (current.length + line.length + 2 > maxChars) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
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
          `• Check back soon - we'll post everything we find!`
        )
        .addFields({ name: 'Version', value: `v${version}`, inline: true })
        .setColor(0xe74c3c)
        .setTimestamp()
        .setFooter({ text: 'Fortnite Datamining Updates' })
    ]);
  }

  state.setHash(db, 'build', currentHash);
}

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

    if (newItems.length > 0) {
      const embeds: EmbedBuilder[] = [];

      const byType = new Map<string, CosmeticItem[]>();
      for (const item of newItems) {
        const type = item.type?.displayValue ?? 'Other';
        if (!byType.has(type)) byType.set(type, []);
        byType.get(type)!.push(item);
      }

      const typeSummary = [...byType.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([type, items]) => `> **${items.length}** ${type}${items.length === 1 ? '' : 's'}`)
        .join('\n');

      const buildDetailedEmbed = (item: CosmeticItem) => {
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
        return embed;
      };

      if (newItems.length <= 20) {
        embeds.push(
          new EmbedBuilder()
            .setTitle(`🆕 ${newItems.length} New Cosmetic${newItems.length === 1 ? '' : 's'} Found!`)
            .setDescription(
              `New items have been added to the game files - these are **unreleased** and could appear in the shop soon!\n\n` +
              typeSummary
            )
            .setColor(0x00b2ff)
            .setTimestamp()
            .setFooter({ text: 'Fortnite Datamining Updates' })
        );

        for (const item of newItems) {
          embeds.push(buildDetailedEmbed(item));
        }
      } else if (newItems.length <= 100) {
        embeds.push(
          new EmbedBuilder()
            .setTitle(`🆕 ${newItems.length} New Cosmetics Found!`)
            .setDescription(
              `New items have been added to the game files - these are **unreleased** and could appear in the shop soon!\n\n` +
              typeSummary
            )
            .setColor(0x00b2ff)
            .setTimestamp()
            .setFooter({ text: 'Fortnite Datamining Updates' })
        );

        const outfits = newItems.filter(i => i.type?.displayValue === 'Outfit' && i.images?.featured);
        const featuredOutfits = outfits.slice(0, 10);
        for (const item of featuredOutfits) {
          embeds.push(buildDetailedEmbed(item));
        }

        const shownIds = new Set(featuredOutfits.map(o => o.id));
        for (const [type, items] of byType) {
          const remaining = items.filter(i => !shownIds.has(i.id));
          if (remaining.length === 0) continue;

          const lines = remaining.map(item => {
            const emoji = rarityEmoji(item.rarity?.displayValue);
            const rarity = item.rarity?.displayValue ?? '';
            const set = item.set?.value ? ` · ${item.set.value}` : '';
            const intro = item.introduction?.text ? ` · ${item.introduction.text}` : '';
            return `${emoji} **${item.name}** - ${rarity}${set}${intro}`;
          });

          const chunks = chunkLines(lines);
          for (let i = 0; i < chunks.length; i++) {
            embeds.push(
              new EmbedBuilder()
                .setTitle(i === 0 ? `${type}s (${items.length})` : `${type}s (cont.)`)
                .setDescription(chunks[i])
                .setColor(0x00b2ff)
            );
          }
        }
      } else {
        embeds.push(
          new EmbedBuilder()
            .setTitle(`🆕 ${newItems.length} New Cosmetics Found!`)
            .setDescription(
              `New items have been added to the game files - these are **unreleased** and could appear in the shop soon!\n\n` +
              typeSummary
            )
            .setColor(0x00b2ff)
            .setTimestamp()
            .setFooter({ text: 'Fortnite Datamining Updates' })
        );

        const outfits = newItems.filter(i => i.type?.displayValue === 'Outfit' && i.images?.featured);
        const featuredOutfits = outfits.slice(0, 8);
        for (const item of featuredOutfits) {
          embeds.push(buildDetailedEmbed(item));
        }

        const shownIds = new Set(featuredOutfits.map(o => o.id));
        for (const [type, items] of byType) {
          const remaining = items.filter(i => !shownIds.has(i.id));
          if (remaining.length === 0) continue;

          const lines = remaining.map(item => {
            const emoji = rarityEmoji(item.rarity?.displayValue);
            const rarity = item.rarity?.displayValue ?? '';
            const set = item.set?.value ? ` · ${item.set.value}` : '';
            return `${emoji} **${item.name}** - ${rarity}${set}`;
          });

          const chunks = chunkLines(lines);
          for (let i = 0; i < chunks.length; i++) {
            embeds.push(
              new EmbedBuilder()
                .setTitle(i === 0 ? `${type}s (${items.length})` : `${type}s (cont.)`)
                .setDescription(chunks[i])
                .setColor(0x00b2ff)
            );
          }
        }
      }

      embeds[embeds.length - 1].setFooter({ text: `${newItems.length} total new items • Fortnite Datamining Updates` });

      await sendToFeeds(client, db, embeds);
    }
  }

  state.setHash(db, 'cosmetics_br', currentHash);
  state.setHash(db, 'cosmetics_br_ids', JSON.stringify(ids));
}

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
      layout?: { name?: string; id?: string };
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
  interface ShopItem {
    name: string;
    price: number;
    regularPrice: number;
    rarity: string;
    type: string;
    giftable: boolean;
    section: string;
  }
  const items: ShopItem[] = [];

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
      giftable: entry.giftable,
      section: entry.layout?.name ?? 'Other',
    });
  }

  const date = new Date(data.data.date);
  const dateStr = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  embeds.push(
    new EmbedBuilder()
      .setTitle(`🛒 Item Shop - ${dateStr}`)
      .setDescription(`The Item Shop has reset! **${items.length} items** available today.`)
      .setColor(0x2ecc71)
      .setTimestamp()
  );

  const bySection = new Map<string, ShopItem[]>();
  for (const item of items) {
    if (!bySection.has(item.section)) bySection.set(item.section, []);
    bySection.get(item.section)!.push(item);
  }

  for (const [section, sectionItems] of bySection) {
    const lines = sectionItems.map(item => {
      const emoji = rarityEmoji(item.rarity);
      const sale = item.regularPrice > item.price ? ` ~~${item.regularPrice.toLocaleString()}~~ **SALE!**` : '';
      const gift = item.giftable ? ' 🎁' : '';
      return `${emoji} **${item.name}** - ${item.price.toLocaleString()} V${sale}${gift}\n> ${item.rarity} ${item.type}`;
    });

    const chunks = chunkLines(lines);
    for (let i = 0; i < chunks.length; i++) {
      embeds.push(
        new EmbedBuilder()
          .setTitle(i === 0 ? `📦 ${section}` : `📦 ${section} (cont.)`)
          .setDescription(chunks[i])
          .setColor(0x2ecc71)
      );
    }
  }

  embeds[embeds.length - 1].setFooter({ text: '🎁 = Giftable • Fortnite Datamining Updates' });

  await sendToFeeds(client, db, embeds);

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
            .setTitle('🔔 Wishlist Alert - Item Shop!')
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

    if (newMotds.length > 0) {
      const embeds: EmbedBuilder[] = [];

      for (const motd of newMotds.slice(0, 10)) {
        const embed = new EmbedBuilder()
          .setTitle(`📰 ${motd.title || 'News Update'}`)
          .setDescription(motd.body || 'No details available')
          .setColor(0xe67e22);
        if (motd.image) embed.setImage(motd.image);
        embed.setTimestamp();
        embed.setFooter({ text: 'Fortnite Datamining Updates' });
        embeds.push(embed);
      }

      if (newMotds.length > 10) {
        embeds.push(
          new EmbedBuilder()
            .setDescription(`...and **${newMotds.length - 10}** more news posts.`)
            .setColor(0xe67e22)
        );
      }

      await sendToFeeds(client, db, embeds);
    }
  }

  state.setHash(db, 'news', currentHash);
  state.setHash(db, 'news_ids', JSON.stringify(motds.map((m) => m.id).sort()));
}

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

    if (newPlaylists.length > 0) {
      const lines = newPlaylists.map((p) => {
        const name = p.name || p.id;
        const desc = p.description || 'No description yet';
        const ltm = p.isLimitedTimeMode ? ' **(LTM)**' : '';
        const players = p.maxPlayers ? ` • Up to ${p.maxPlayers} players` : '';
        const squad = p.maxSquadSize && p.maxSquadSize > 1 ? ` • Squads of ${p.maxSquadSize}` : '';
        return `🎮 **${name}**${ltm}\n> ${desc}${players}${squad}`;
      });

      const chunks = chunkLines(lines);
      const embeds: EmbedBuilder[] = [];
      for (let i = 0; i < chunks.length; i++) {
        embeds.push(
          new EmbedBuilder()
            .setTitle(i === 0 ? `🎮 ${newPlaylists.length} New Gamemode${newPlaylists.length === 1 ? '' : 's'} Detected!` : '🎮 Gamemodes (cont.)')
            .setDescription(i === 0 ? `New gamemodes have been added to the files:\n\n${chunks[i]}` : chunks[i])
            .setColor(0x9b59b6)
            .setTimestamp()
        );
      }
      embeds[embeds.length - 1].setFooter({ text: 'Fortnite Datamining Updates' });
      await sendToFeeds(client, db, embeds);
    }
  }

  state.setHash(db, 'playlists', currentHash);
  state.setHash(db, 'playlists_ids', JSON.stringify(ids));
}

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

    if (newTracks.length > 0) {
      const lines = newTracks.map((t) => {
        const duration = t.duration ? `${Math.floor(t.duration / 60)}:${String(t.duration % 60).padStart(2, '0')}` : '';
        const genre = t.genres?.join(', ') ?? '';
        return `🎵 **${t.title}** by **${t.artist}**\n> ${genre}${duration ? ` • ${duration}` : ''}${t.releaseYear ? ` • ${t.releaseYear}` : ''}`;
      });

      const chunks = chunkLines(lines);
      const embeds: EmbedBuilder[] = [];
      for (let i = 0; i < chunks.length; i++) {
        embeds.push(
          new EmbedBuilder()
            .setTitle(i === 0 ? `🎵 ${newTracks.length} New Jam Track${newTracks.length === 1 ? '' : 's'} Found!` : '🎵 Jam Tracks (cont.)')
            .setDescription(i === 0 ? `New songs are coming to Fortnite Festival:\n\n${chunks[i]}` : chunks[i])
            .setColor(0x1db954)
            .setTimestamp()
        );
      }
      embeds[embeds.length - 1].setFooter({ text: 'Fortnite Datamining Updates' });
      await sendToFeeds(client, db, embeds);
    }
  }

  state.setHash(db, 'tracks', currentHash);
  state.setHash(db, 'tracks_ids', JSON.stringify(ids));
}

interface LegoItem {
  id: string;
  cosmeticId?: string;
  name?: string;
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

    if (newItems.length > 0) {
      const embeds: EmbedBuilder[] = [
        new EmbedBuilder()
          .setTitle(`🧱 ${newItems.length} New LEGO Skin${newItems.length === 1 ? '' : 's'} Found!`)
          .setDescription(`New LEGO styles have been added to the game files!`)
          .setColor(0xffd500)
          .setTimestamp()
          .setFooter({ text: 'Fortnite Datamining Updates' })
      ];

      for (const item of newItems.slice(0, 10)) {
        const img = item.images?.large ?? item.images?.small;
        if (img) {
          const embed = new EmbedBuilder().setImage(img).setColor(0xffd500);
          if (item.name) embed.setTitle(`🧱 ${item.name}`);
          embeds.push(embed);
        }
      }

      if (newItems.length > 10) {
        embeds.push(
          new EmbedBuilder()
            .setDescription(`...and **${newItems.length - 10}** more LEGO skins! View all on [GitHub](https://github.com/${REPO}).`)
            .setColor(0xffd500)
        );
      }

      await sendToFeeds(client, db, embeds);
    }
  }

  state.setHash(db, 'lego', currentHash);
  state.setHash(db, 'lego_ids', JSON.stringify(ids));
}

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

    if (newItems.length > 0) {
      const lines = newItems.map((c) => `🚗 **${c.name}**${c.description ? `\n> ${c.description}` : ''}`);

      const chunks = chunkLines(lines);
      const embeds: EmbedBuilder[] = [];
      for (let i = 0; i < chunks.length; i++) {
        embeds.push(
          new EmbedBuilder()
            .setTitle(i === 0 ? `🚗 ${newItems.length} New Vehicle Cosmetic${newItems.length === 1 ? '' : 's'} Found!` : '🚗 Vehicles (cont.)')
            .setDescription(i === 0 ? `New vehicle cosmetics have been added:\n\n${chunks[i]}` : chunks[i])
            .setColor(0x3498db)
            .setTimestamp()
        );
      }
      embeds[embeds.length - 1].setFooter({ text: 'Fortnite Datamining Updates' });
      await sendToFeeds(client, db, embeds);
    }
  }

  state.setHash(db, 'cars', currentHash);
  state.setHash(db, 'cars_ids', JSON.stringify(ids));
}

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

    if (newItems.length > 0) {
      const lines = newItems.map((i) => {
        const rarity = i.rarity?.displayValue ?? '';
        return `🎸 **${i.name}**${rarity ? ` • ${rarity}` : ''}${i.description ? `\n> ${i.description}` : ''}`;
      });

      const chunks = chunkLines(lines);
      const embeds: EmbedBuilder[] = [];
      for (let i = 0; i < chunks.length; i++) {
        embeds.push(
          new EmbedBuilder()
            .setTitle(i === 0 ? `🎸 ${newItems.length} New Instrument${newItems.length === 1 ? '' : 's'} Found!` : '🎸 Instruments (cont.)')
            .setDescription(i === 0 ? `New Festival instruments have been added:\n\n${chunks[i]}` : chunks[i])
            .setColor(0xe91e63)
            .setTimestamp()
        );
      }
      embeds[embeds.length - 1].setFooter({ text: 'Fortnite Datamining Updates' });
      await sendToFeeds(client, db, embeds);
    }
  }

  state.setHash(db, 'instruments', currentHash);
  state.setHash(db, 'instruments_ids', JSON.stringify(ids));
}

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

    if (newItems.length > 0) {
      const lines = newItems.map((b) => `🏳️ **${b.name || b.id}**${b.description ? ` - ${b.description}` : ''}`);

      const chunks = chunkLines(lines);
      const embeds: EmbedBuilder[] = [];
      for (let i = 0; i < chunks.length; i++) {
        embeds.push(
          new EmbedBuilder()
            .setTitle(i === 0 ? `🏳️ ${newItems.length} New Banner${newItems.length === 1 ? '' : 's'} Found!` : '🏳️ Banners (cont.)')
            .setDescription(i === 0 ? `New banners have been added:\n\n${chunks[i]}` : chunks[i])
            .setColor(0x1abc9c)
            .setTimestamp()
        );
      }
      embeds[embeds.length - 1].setFooter({ text: 'Fortnite Datamining Updates' });
      await sendToFeeds(client, db, embeds);
    }
  }

  state.setHash(db, 'banners', currentHash);
  state.setHash(db, 'banners_ids', JSON.stringify(ids));
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

export function startPoller(client: Client, db: Db) {
  if (pollTimer) return;

  console.log('[Poller] Started - watching GitHub repo every 5 min');

  const poll = async () => {
    const allFeeds = feeds.getAll(db);
    if (allFeeds.length === 0) {
      console.log('[Poller] No feeds configured - skipping. Use /setup to add a channel.');
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
