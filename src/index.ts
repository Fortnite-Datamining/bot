import 'dotenv/config';
import { Client, Events, GatewayIntentBits, TextChannel } from 'discord.js';
import { openDb, feeds } from './db.js';
import { startPoller } from './poller.js';

const token = process.env.DISCORD_TOKEN;
const dbPath = process.env.DB_PATH ?? './data/bot.sqlite';

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
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  const { commandName } = interaction;

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
