import 'dotenv/config';
import { Client, Events, GatewayIntentBits, TextChannel } from 'discord.js';
import { openDb, feeds, wishlists } from './db.js';
import { startPoller } from './poller.js';

const token = process.env.DISCORD_TOKEN;
const dbPath = process.env.DB_PATH ?? './data/bot.sqlite';

const BLOCKED_WORDS = new Set([
  'nigga', 'nigger', 'faggot', 'fag', 'retard', 'tranny', 'kike', 'spic',
  'chink', 'wetback', 'coon', 'gook', 'dyke', 'beaner', 'towelhead',
  'negro', 'niggas', 'niggers', 'faggots', 'fags', 'retards', 'trannies',
]);

function containsSlur(text: string): boolean {
  const lower = text.toLowerCase().replace(/[^a-z]/g, '');
  for (const word of BLOCKED_WORDS) {
    if (lower.includes(word)) return true;
  }
  return false;
}

if (!token) {
  console.error('Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

const db = openDb(dbPath);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  startPoller(client, db);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'notify') {
    const skin = interaction.options.getString('skin', true).trim();
    if (skin.length < 2 || skin.length > 100) {
      await interaction.reply({ content: 'Skin name must be between 2 and 100 characters.', ephemeral: true });
      return;
    }
    if (containsSlur(skin)) {
      await interaction.reply({ content: 'That name contains inappropriate language.', ephemeral: true });
      return;
    }
    const existing = wishlists.getForUser(db, interaction.user.id);
    if (existing.length >= 25) {
      await interaction.reply({ content: 'You can only track up to 25 skins. Use `/unnotify` to remove one first.', ephemeral: true });
      return;
    }
    wishlists.add(db, interaction.user.id, skin);
    await interaction.reply({
      content: `✅ You'll be DM'd when **${skin}** appears in the Item Shop!\n\n*Make sure your DMs are open so I can message you.*`,
      ephemeral: true
    });
    return;
  }

  if (commandName === 'unnotify') {
    const skin = interaction.options.getString('skin', true).trim();
    const result = wishlists.remove(db, interaction.user.id, skin);
    if (result.changes > 0) {
      await interaction.reply({ content: `✅ Removed **${skin}** from your wishlist.`, ephemeral: true });
    } else {
      await interaction.reply({ content: `**${skin}** wasn't on your wishlist.`, ephemeral: true });
    }
    return;
  }

  if (commandName === 'wishlist') {
    const items = wishlists.getForUser(db, interaction.user.id);
    if (items.length === 0) {
      await interaction.reply({ content: 'Your wishlist is empty. Use `/notify` to add skins!', ephemeral: true });
    } else {
      const list = items.map((i, idx) => `${idx + 1}. **${i.item_name}**`).join('\n');
      await interaction.reply({
        content: `🛒 **Your Item Shop Wishlist** (${items.length}/25)\n\n${list}\n\n*You'll be DM'd when any of these appear in the shop.*`,
        ephemeral: true
      });
    }
    return;
  }

  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  if (commandName === 'setup') {
    const channel = interaction.options.getChannel('channel', true);
    feeds.add(db, interaction.guildId, channel.id);
    await interaction.reply({
      content: `✅ Fortnite datamining updates will now post in <#${channel.id}>.\n\nUpdates are checked every 5 minutes. You'll see posts whenever new skins, shop changes, game updates, or other changes are detected.`,
      ephemeral: true
    });
  }

  else if (commandName === 'remove') {
    const channel = interaction.options.getChannel('channel', true);
    feeds.remove(db, interaction.guildId, channel.id);
    await interaction.reply({
      content: `❌ Fortnite updates disabled for <#${channel.id}>.`,
      ephemeral: true
    });
  }

  else if (commandName === 'status') {
    const guildFeeds = feeds.getForGuild(db, interaction.guildId);
    if (guildFeeds.length === 0) {
      await interaction.reply({
        content: 'No Fortnite datamining feeds set up. Use `/setup` to get started.',
        ephemeral: true
      });
    } else {
      const channels = guildFeeds.map((f) => `<#${f.channel_id}>`).join(', ');
      await interaction.reply({
        content: `📡 Fortnite updates are posting in: ${channels}`,
        ephemeral: true
      });
    }
  }
});

client.login(token);
