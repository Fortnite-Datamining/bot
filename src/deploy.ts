import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder, ChannelType } from 'discord.js';

const token = process.env.DISCORD_TOKEN!;
const clientId = process.env.DISCORD_CLIENT_ID!;

const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Set the channel for Fortnite datamining updates')
    .addChannelOption((o) =>
      o.setName('channel').setDescription('Channel to post updates in').addChannelTypes(ChannelType.GuildText).setRequired(true)
    )
    .setDefaultMemberPermissions(0x20) // ManageGuild
    .toJSON(),

  new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Stop posting Fortnite updates in a channel')
    .addChannelOption((o) =>
      o.setName('channel').setDescription('Channel to stop posting in').addChannelTypes(ChannelType.GuildText).setRequired(true)
    )
    .setDefaultMemberPermissions(0x20)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show which channels are receiving Fortnite updates')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('notify')
    .setDescription('Get DM\'d when a skin appears in the Item Shop')
    .addStringOption((o) =>
      o.setName('skin').setDescription('Name of the skin (e.g. Peely, Renegade Raider)').setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('unnotify')
    .setDescription('Remove a skin from your wishlist')
    .addStringOption((o) =>
      o.setName('skin').setDescription('Name of the skin to remove').setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('wishlist')
    .setDescription('View your Item Shop wishlist')
    .toJSON()
];

const rest = new REST({ version: '10' }).setToken(token);

console.log('Deploying slash commands...');
rest.put(Routes.applicationCommands(clientId), { body: commands })
  .then(() => console.log('Commands deployed!'))
  .catch(console.error);
