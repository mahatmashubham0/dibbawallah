import { Command } from 'commander';
import { PrismaClient } from '@prisma/client';
import { isEmail } from 'class-validator';
import { admin, seedAreas, seedNotificationTemplates } from './seeds';

const program = new Command();
program.option('--seed-only <name>', 'Specify a seed name').parse(process.argv);

const prisma = new PrismaClient();

async function main() {
  const options = program.opts();

  // Seed admin default credential
  if (!options.seedOnly || options.seedOnly === 'admin') {
    if (await prisma.admin.count()) {
      console.log('⚠ Skipping seed for `admin`, due to non-empty table');
    } else {
      if (
        isEmail(admin.email) &&
        admin.meta?.create?.passwordHash &&
        admin.meta.create.passwordSalt
      ) {
        await prisma.admin.create({
          data: admin,
        });
      } else {
        console.error(new Error('Invalid default admin credentials found'));
      }
    }
  }

  if (!options.seedOnly || options.seedOnly === 'areas') {
    await seedAreas();
  }

  if (!options.seedOnly || options.seedOnly === 'notifications') {
    await seedNotificationTemplates();
  }
}
// npx ts-node prisma/seeds/seed.ts --seed-only areas

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
