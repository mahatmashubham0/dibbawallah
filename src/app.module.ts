import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MulterModule } from '@nestjs/platform-express';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CacheModule } from '@nestjs/cache-manager';
import { CommonModule, StorageService } from '@Common';
import { AppController } from './app.controller';
import { AppCacheInterceptor } from './app-cache.interceptor';
import { PrismaModule } from './prisma';
import { AuthModule } from './auth';
import { RedisModule } from './redis';
import { VendorsModule } from './vendors';
import { LocationModule } from './location';
import { MealsModule } from './meals/meals.module';
import { DailyMenuModule } from './daily-menu/daily-menu.module'
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { WalletModule } from './wallet/wallet.module';
import { NotificationModule } from './notification/notification.module';
import { CustomersModule } from './customers';

@Module({
  imports: [
    MulterModule.registerAsync({
      useFactory: (storageService: StorageService) => ({
        ...storageService.defaultMulterOptions,
      }),
      inject: [StorageService],
    }),
    CacheModule.register({ isGlobal: true , ttl: 1}),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    CommonModule,
    PrismaModule,
    RedisModule,
    AuthModule,
    VendorsModule,
    LocationModule,
    MealsModule,
    DailyMenuModule,
    SubscriptionsModule,
    WalletModule,
    NotificationModule,
    CustomersModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: AppCacheInterceptor,
    },
  ],
})
export class AppModule {}
