import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      errorFormat: 'minimal',
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
    } catch (error) {
      this.logger.error(
        'Prisma could not connect during startup. Swagger can still load, but database-backed APIs will fail until the database is available.',
        error instanceof Error ? error.stack : undefined,
      );

      if (process.env.NODE_ENV === 'production') {
        throw error;
      }
    }
  }

  async onApplicationShutdown() {
    await this.$disconnect();
  }
}
