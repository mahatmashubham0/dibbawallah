/* eslint-disable prettier/prettier */
import { PrismaClient } from '@prisma/client';
import indoreData from '../datasets/indore.json';

const prisma = new PrismaClient();

function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '');
}

async function getOrCreateCityAndState(stateName: string, cityName: string) {
  const stateNormalizedName = normalizeName(stateName);

  const state = await prisma.state.upsert({
    where: {
      normalizedName: stateNormalizedName,
    },
    update: {
      name: stateName,
      isActive: true,
    },
    create: {
      name: stateName,
      normalizedName: stateNormalizedName,
      isActive: true,
    },
  });

  const cityNormalizedName = normalizeName(cityName);

  const city = await prisma.city.upsert({
    where: {
      stateId_normalizedName: {
        stateId: state.id,
        normalizedName: cityNormalizedName,
      },
    },
    update: {
      name: cityName,
      isActive: true,
    },
    create: {
      stateId: state.id,
      name: cityName,
      normalizedName: cityNormalizedName,
      isActive: true,
    },
  });

  return { state, city };
}

export async function seedAreas() {
  console.log('🌱 Seeding areas...');

  const { state, city } = await getOrCreateCityAndState(
    indoreData.state,
    indoreData.city,
  );

  const batchSize = 100;

  for (let i = 0; i < indoreData.areas.length; i += batchSize) {
    const batch = indoreData.areas.slice(i, i + batchSize);

    await prisma.$transaction(
      batch.map((area) =>
        prisma.area.upsert({
          where: {
            cityId_normalizedName: {
              cityId: city.id,
              normalizedName: normalizeName(area.name),
            },
          },
          update: {
            pincode: area.pincode ?? null,
            isActive: true,
          },
          create: {
            stateId: state.id,
            cityId: city.id,
            name: area.name,
            normalizedName: normalizeName(area.name),
            pincode: area.pincode ?? null,
            isActive: true,
          },
        }),
      ),
    );

    console.log(
      `Processed ${Math.min(i + batchSize, indoreData.areas.length)}/${indoreData.areas.length}`,
    );
  }

  console.log('✅ Areas synced successfully');
}
