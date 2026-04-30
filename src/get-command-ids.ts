import 'dotenv/config';
import { REST, Routes } from 'discord.js';

const token = process.env.DISCORD_TOKEN!;
const clientId = process.env.DISCORD_CLIENT_ID!;

const rest = new REST({ version: '10' }).setToken(token);

async function main() {
  console.log('Fetching registered slash commands...\n');
  const commands = await rest.get(Routes.applicationCommands(clientId)) as { id: string; name: string; description: string }[];

  if (commands.length === 0) {
    console.log('No commands registered. Run `npm run deploy` first.');
    return;
  }

  console.log('── Command Mentions (paste into bot description) ──\n');
  for (const cmd of commands) {
    console.log(`${cmd.name.padEnd(12)} → </${cmd.name}:${cmd.id}>`);
  }

  console.log('\n── Example Description ──\n');
  const byName = Object.fromEntries(commands.map(c => [c.name, c.id]));
  const setup = byName.setup ? `</setup:${byName.setup}>` : '/setup';
  const notify = byName.notify ? `</notify:${byName.notify}>` : '/notify';
  const wishlist = byName.wishlist ? `</wishlist:${byName.wishlist}>` : '/wishlist';
  const status = byName.status ? `</status:${byName.status}>` : '/status';

  console.log(
    `Real-time Fortnite datamining updates - new skins, item shop, game updates, and more.\n\n` +
    `${setup} to set up updates in a channel\n` +
    `${notify} to get DM'd when a skin hits the shop\n` +
    `${wishlist} to see your tracked skins\n` +
    `${status} to see active channels`
  );
}

main().catch(console.error);
