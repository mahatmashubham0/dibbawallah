import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma';
import { Country, State, City } from 'country-state-city';
import axios from 'axios';

@Injectable()
export class LocationService {
  constructor(private readonly prisma: PrismaService) {}

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

  async getAreas(cityId: number) {
    // const existingAreas = await this.prisma.area.findMany({
    //   where: {
    //     cityId,
    //     isActive: true,
    //   },
    //   orderBy: {
    //     name: 'asc',
    //   },
    // });

    // if (existingAreas.length > 0) {
    //   return existingAreas;
    // }

    // const city = await this.prisma.city.findUnique({
    //   where: {
    //     id: cityId,
    //   },
    // });

    // if (!city) {
    //   throw new Error('City not found');
    // }

    await this.fetchAndStoreAreas('city');

    return this.prisma.area.findMany({
      where: {
        cityId,
        isActive: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  private async fetchAndStoreAreas(city: any) {
    const apiKey = '1642722940e74e709804561beee740ca';
    console.log('data', apiKey);

    const geoResponse = await axios.get(
      'https://api.geoapify.com/v1/geocode/search',
      {
        params: {
          city: 'indore',
          state: 'madhya pradesh',
          country: 'India',
          format: 'json',
          apiKey,
        },
      },
    );

    const location = geoResponse.data?.results?.[0];
    console.log('data', location);

    if (!location) {
      return;
    }

    const lat = location.lat;
    const lon = location.lon;

    const placesResponse = await axios.get(
      'https://api.geoapify.com/v2/places',
      {
        params: {
          categories: 'populated_place.suburb,populated_place.neighbourhood',
          filter: `circle:${lon},${lat},25000`,
          limit: 500,
          apiKey,
        },
      },
    );

    const features = placesResponse.data?.features || [];

    const uniqueAreas = new Map<
      string,
      {
        stateId: number;
        cityId: number;
        name: string;
        normalizedName: string;
        latitude: any;
        longitude: any;
      }
    >();

    console.log('data', features);

    for (const feature of features) {
      const areaName = feature?.properties?.name?.trim();

      if (!areaName) {
        continue;
      }

      const normalizedName = areaName.toLowerCase().trim();

      if (!uniqueAreas.has(normalizedName)) {
        uniqueAreas.set(normalizedName, {
          stateId: city.stateId,
          cityId: city.id,
          name: areaName,
          normalizedName,
          latitude: feature?.properties?.lat ?? null,
          longitude: feature?.properties?.lon ?? null,
        });
      }
    }

    if (uniqueAreas.size === 0) {
      return;
    }

    await this.prisma.area.createMany({
      data: Array.from(uniqueAreas.values()),
      skipDuplicates: true,
    });
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
