import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma';
import { Country, State, City } from 'country-state-city';
import { Prisma, Area } from '@prisma/client';
@Injectable()
export class LocationService {
  constructor(private readonly prisma: PrismaService) { }

  private countryNameToCode = new Map<string, string>();
  private countryCodeToData = new Map<string, any>();
  onModuleInit() {
    const countries = Country.getAllCountries();

    for (const c of countries) {
      const normalized = this.normalize(c.name);
      this.countryNameToCode.set(normalized, c.isoCode);
      this.countryCodeToData.set(c.isoCode, c);
      if (c.name === 'United States') {
        this.countryNameToCode.set('usa', c.isoCode);
        this.countryNameToCode.set('us', c.isoCode);
      }
    }
  }

  private normalize(value?: string): string {
    return value?.toLowerCase().replace(/\./g, '').trim() || '';
  }

  getCountryCode(countryName: string): string {
    console.log('ciuntr', countryName);
    if (!countryName) return 'IN';
    const normalized = this.normalize(countryName);
    const code = this.countryNameToCode.get(normalized);
    console.log('data code', code);
    if (code) return code;
    for (const [key, value] of this.countryNameToCode.entries()) {
      if (key.includes(normalized) || normalized.includes(key)) {
        return value;
      }
    }
    return 'IN';
  }

  getCountries(search?: string) {
    let countries = Country.getAllCountries();

    if (search) {
      const q = search.toLowerCase();
      countries = countries.filter((c) => c.name.toLowerCase().includes(q));
    }

    return countries.map((c) => ({
      name: c.name,
      code: c.isoCode,
      dialCode: `+${c.phonecode}`,
      flag: c.flag,
    }));
  }

  getStates(countryCode: string, search?: string) {
    let states = State.getStatesOfCountry(countryCode);

    if (search) {
      const q = search.toLowerCase();
      states = states.filter((s) => s.name.toLowerCase().includes(q));
    }

    return states.map((s) => ({
      name: s.name,
      code: s.isoCode,
    }));
  }

  getCities(countryCode: string, stateCode: string, search?: string) {
    let cities = City.getCitiesOfState(countryCode, stateCode);

    if (search) {
      const q = search.toLowerCase();
      cities = cities.filter((c) => c.name.toLowerCase().includes(q));
    }

    return cities.map((c) => ({
      name: c.name,
      stateCode: c.stateCode,
      countryCode: c.countryCode,
      latitude: c.latitude,
      longitude: c.longitude,
    }));
  }

  async getAllAreas(options?: {
    search?: string;
    skip?: number;
    take?: number;
  }): Promise<{
    count: number;
    skip: number;
    take: number;
    data: Area[];
  }> {
    const search = options?.search?.trim();
    const pagination = { skip: options?.skip || 0, take: options?.take || 10 };
    const where: Prisma.AreaWhereInput = {};
    if (search) {
      const buildSearchFilter = (search: string): Prisma.AreaWhereInput[] => [
        {
          name: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          normalizedName: {
            contains: search,
            mode: 'insensitive',
          },
        },
      ];
      const parts = search.split(' ');
      if (parts.length !== 0) {
        where.AND = [];
        for (const part of parts) {
          if (part.trim()) {
            where.AND.push({
              OR: buildSearchFilter(part.trim()),
            });
          }
        }
      }
    }

    const totalArea = await this.prisma.area.count({
      where,
    });
    const areas = await this.prisma.area.findMany({
      where,
      orderBy: { id: Prisma.SortOrder.asc },
      skip: pagination.skip,
      take: pagination.take,
    });

    return {
      count: totalArea,
      skip: pagination.skip,
      take: pagination.take,
      data: areas,
    };
  }

  async getOrCreateHierarchy(
    tx: Prisma.TransactionClient,
    countryName: string,
    stateName: string,
    cityName: string,
    areaName: string,
  ) {
    const countryNormalized = this.normalize(countryName);
    const stateNormalized = this.normalize(stateName);
    const cityNormalized = this.normalize(cityName);
    const areaNormalized = this.normalize(areaName);

    const state = await tx.state.upsert({
      where: {
        normalizedName: stateNormalized,
      },
      create: {
        name: stateName,
        normalizedName: stateNormalized,
      },
      update: {},
    });

    const city = await tx.city.upsert({
      where: {
        stateId_normalizedName: {
          stateId: state.id,
          normalizedName: cityNormalized,
        },
      },
      create: {
        stateId: state.id,
        name: cityName,
        normalizedName: cityNormalized,
      },
      update: {},
    });

    const area = await tx.area.upsert({
      where: {
        cityId_normalizedName: {
          cityId: city.id,
          normalizedName: areaNormalized,
        },
      },
      create: {
        stateId: city.stateId,
        cityId: city.id,
        name: areaName,
        normalizedName: areaNormalized,
      },
      update: {},
    });

    return {
      country: countryNormalized,
      state,
      city,
      area,
    };
  }

  parsePlace(place?: string) {
    if (!place) {
      return { city: null, state: null, country: null };
    }

    const parts = place
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    let city: string | null = null;
    let state: string | null = null;
    let country: string | null = null;

    if (parts.length === 1) {
      country = parts[0];
    } else if (parts.length === 2) {
      state = parts[0];
      country = parts[1];
    } else if (parts.length >= 3) {
      city = parts[0];
      state = parts[1];
      country = parts[parts.length - 1];
    }

    if (!country) {
      throw new Error('country is required');
    }

    return { city, state, country };
  }
}
