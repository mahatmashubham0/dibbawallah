import axios from 'axios';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { locationConfigFactory } from '@Config';
import { PrismaService } from '../prisma';

type StateRecord = {
  id: number;
  name: string;
  code: string | null;
};

type CityRecord = {
  id: number;
  stateId: number;
  name: string;
  latitude: string | null;
  longitude: string | null;
};

type CityContext = {
  id: number;
  name: string;
  stateId: number;
  stateName: string;
};

type AreaRecord = {
  id: number;
  cityId: number;
  name: string;
  normalizedName: string;
  latitude: string | null;
  longitude: string | null;
  source: string;
  externalId: string | null;
  isActive: boolean;
};

type GeoapifyFeature = {
  properties?: {
    place_id?: string;
    suburb?: string;
    district?: string;
    county?: string;
    city?: string;
    state?: string;
    formatted?: string;
    lat?: number;
    lon?: number;
    result_type?: string;
  };
};

@Injectable()
export class LocationsService {
  constructor(
    @Inject(locationConfigFactory.KEY)
    private readonly config: ConfigType<typeof locationConfigFactory>,
    private readonly prisma: PrismaService,
  ) {}

  private normalizeSearch(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private sanitizeText(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
  }

  private async getCityContext(cityId: number): Promise<CityContext> {
    const rows = await this.prisma.$queryRaw<CityContext[]>(
      Prisma.sql`
        SELECT
          c.id,
          c.name,
          c.state_id AS "stateId",
          s.name AS "stateName"
        FROM city c
        INNER JOIN state s ON s.id = c.state_id
        WHERE c.id = ${cityId} AND c.is_active = true AND s.is_active = true
        LIMIT 1
      `,
    );

    if (!rows.length) {
      throw new NotFoundException('City not found');
    }

    return rows[0];
  }

  async searchStates(search?: string): Promise<StateRecord[]> {
    console.log('data', { search });
    const trimmedSearch = search?.trim();

    if (!trimmedSearch) {
      return await this.prisma.$queryRaw<StateRecord[]>(
        Prisma.sql`
          SELECT id, name, code
          FROM state
          WHERE is_active = true
          ORDER BY name ASC
          LIMIT 20
        `,
      );
    }

    return await this.prisma.$queryRaw<StateRecord[]>(
      Prisma.sql`
        SELECT id, name, code
        FROM state
        WHERE is_active = true
          AND name ILIKE ${`%${trimmedSearch}%`}
        ORDER BY
          CASE
            WHEN LOWER(name) = LOWER(${trimmedSearch}) THEN 0
            WHEN LOWER(name) LIKE LOWER(${`${trimmedSearch}%`}) THEN 1
            ELSE 2
          END,
          LENGTH(name),
          name ASC
        LIMIT 20
      `,
    );
  }

  async searchCities(search?: string, stateId?: number): Promise<CityRecord[]> {
    const trimmedSearch = search?.trim();

    if (!trimmedSearch && !stateId) {
      return await this.prisma.$queryRaw<CityRecord[]>(
        Prisma.sql`
          SELECT
            id,
            state_id AS "stateId",
            name,
            latitude::text AS latitude,
            longitude::text AS longitude
          FROM city
          WHERE is_active = true
          ORDER BY name ASC
          LIMIT 20
        `,
      );
    }

    const stateFilter = stateId
      ? Prisma.sql`AND state_id = ${stateId}`
      : Prisma.empty;
    const searchFilter = trimmedSearch
      ? Prisma.sql`AND name ILIKE ${`%${trimmedSearch}%`}`
      : Prisma.empty;
    const exactPriority = trimmedSearch
      ? Prisma.sql`
          CASE
            WHEN LOWER(name) = LOWER(${trimmedSearch}) THEN 0
            WHEN LOWER(name) LIKE LOWER(${`${trimmedSearch}%`}) THEN 1
            ELSE 2
          END
        `
      : Prisma.sql`0`;

    return await this.prisma.$queryRaw<CityRecord[]>(
      Prisma.sql`
        SELECT
          id,
          state_id AS "stateId",
          name,
          latitude::text AS latitude,
          longitude::text AS longitude
        FROM city
        WHERE is_active = true
          ${stateFilter}
          ${searchFilter}
        ORDER BY
          ${exactPriority},
          LENGTH(name),
          name ASC
        LIMIT 20
      `,
    );
  }

  async searchAreas(
    search: string,
    cityId: number,
    take = 20,
  ): Promise<AreaRecord[]> {
    const trimmedSearch = this.sanitizeText(search);
    const normalizedSearch = this.normalizeSearch(trimmedSearch);
    if (!normalizedSearch) {
      return [];
    }

    await this.getCityContext(cityId);

    const areas = await this.prisma.$queryRaw<AreaRecord[]>(
      Prisma.sql`
        SELECT
          id,
          city_id AS "cityId",
          name,
          normalized_name AS "normalizedName",
          latitude::text AS latitude,
          longitude::text AS longitude,
          source::text AS source,
          external_id AS "externalId",
          is_active AS "isActive"
        FROM area
        WHERE city_id = ${cityId}
          AND is_active = true
          AND (
            normalized_name LIKE ${`%${normalizedSearch}%`}
            OR LOWER(name) LIKE LOWER(${`%${trimmedSearch}%`})
          )
        ORDER BY
          CASE
            WHEN normalized_name = ${normalizedSearch} THEN 0
            WHEN normalized_name LIKE ${`${normalizedSearch}%`} THEN 1
            WHEN LOWER(name) = LOWER(${trimmedSearch}) THEN 2
            WHEN LOWER(name) LIKE LOWER(${`${trimmedSearch}%`}) THEN 3
            ELSE 4
          END,
          LENGTH(normalized_name),
          name ASC
        LIMIT ${Math.min(take, 50)}
      `,
    );

    if (areas.length) {
      return areas;
    }

    return await this.fetchAndStoreFromGeoapify(trimmedSearch, cityId, take);
  }

  private extractAreaName(feature: GeoapifyFeature): string | null {
    const properties = feature.properties;
    if (!properties) return null;

    return (
      properties.suburb ||
      properties.district ||
      properties.county ||
      properties.formatted ||
      null
    );
  }

  private async fetchGeoapifyAreas(
    search: string,
    city: CityContext,
  ): Promise<GeoapifyFeature[]> {
    if (!this.config.geoapifyApiKey) {
      return [];
    }

    const response = await axios.get<{
      features?: GeoapifyFeature[];
    }>(`${this.config.geoapifyBaseUrl}/geocode/autocomplete`, {
      params: {
        text: `${search}, ${city.name}, ${city.stateName}, India`,
        apiKey: this.config.geoapifyApiKey,
        limit: this.config.geoapifyLimit,
        type: 'amenity,street,locality,neighbourhood,suburb',
      },
      timeout: 5000,
    });

    return response.data.features || [];
  }

  private async upsertArea(args: {
    cityId: number;
    name: string;
    normalizedName: string;
    latitude: number | null;
    longitude: number | null;
    externalId: string | null;
  }): Promise<AreaRecord> {
    const rows = await this.prisma.$queryRaw<AreaRecord[]>(
      Prisma.sql`
        INSERT INTO area (
          city_id,
          name,
          normalized_name,
          latitude,
          longitude,
          source,
          external_id,
          is_active
        )
        VALUES (
          ${args.cityId},
          ${args.name},
          ${args.normalizedName},
          ${args.latitude},
          ${args.longitude},
          'geoapify',
          ${args.externalId},
          true
        )
        ON CONFLICT (city_id, normalized_name)
        DO UPDATE SET
          name = EXCLUDED.name,
          latitude = COALESCE(EXCLUDED.latitude, area.latitude),
          longitude = COALESCE(EXCLUDED.longitude, area.longitude),
          external_id = COALESCE(EXCLUDED.external_id, area.external_id),
          is_active = true,
          updated_at = NOW()
        RETURNING
          id,
          city_id AS "cityId",
          name,
          normalized_name AS "normalizedName",
          latitude::text AS latitude,
          longitude::text AS longitude,
          source::text AS source,
          external_id AS "externalId",
          is_active AS "isActive"
      `,
    );

    return rows[0];
  }

  async fetchAndStoreFromGeoapify(
    search: string,
    cityId: number,
    take = 20,
  ): Promise<AreaRecord[]> {
    const city = await this.getCityContext(cityId);
    const normalizedSearch = this.normalizeSearch(search);
    const features = await this.fetchGeoapifyAreas(search, city);

    const uniqueAreas = new Map<
      string,
      {
        name: string;
        latitude: number | null;
        longitude: number | null;
        externalId: string | null;
      }
    >();

    for (const feature of features) {
      const rawName = this.extractAreaName(feature);
      if (!rawName) continue;

      const name = this.sanitizeText(rawName);
      const normalizedName = this.normalizeSearch(name);
      if (!normalizedName) continue;
      if (!normalizedName.includes(normalizedSearch)) continue;

      const featureCity = feature.properties?.city?.toLowerCase();
      const featureState = feature.properties?.state?.toLowerCase();
      if (
        (featureCity && featureCity !== city.name.toLowerCase()) ||
        (featureState && featureState !== city.stateName.toLowerCase())
      ) {
        continue;
      }

      if (!uniqueAreas.has(normalizedName)) {
        uniqueAreas.set(normalizedName, {
          name,
          latitude: feature.properties?.lat || null,
          longitude: feature.properties?.lon || null,
          externalId: feature.properties?.place_id || null,
        });
      }
    }

    const storedAreas = await Promise.all(
      [...uniqueAreas.entries()].slice(0, take).map(([normalizedName, value]) =>
        this.upsertArea({
          cityId,
          name: value.name,
          normalizedName,
          latitude: value.latitude,
          longitude: value.longitude,
          externalId: value.externalId,
        }),
      ),
    );

    return storedAreas.sort((left, right) => {
      const leftRank = left.normalizedName === normalizedSearch ? 0 : 1;
      const rightRank = right.normalizedName === normalizedSearch ? 0 : 1;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.name.localeCompare(right.name);
    });
  }
}
