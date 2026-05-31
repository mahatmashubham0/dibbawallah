import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigType } from '@nestjs/config';
import { jwtConfigFactory } from '@Config';
import { OtpModule } from '../otp';
import { PrismaModule } from '../prisma';
import { VendorsAuthController } from './vendors-auth.controller';
import { VendorsController } from './vendors.controller';
import { VendorsService } from './vendors.service';
import { LocationModule } from 'src/location';

@Module({
  imports: [
    PrismaModule,
    OtpModule,
    LocationModule,
    JwtModule.registerAsync({
      useFactory: (config: ConfigType<typeof jwtConfigFactory>) => ({
        secret: config.secret,
        signOptions: config.signOptions,
      }),
      inject: [jwtConfigFactory.KEY],
    }),
  ],
  controllers: [VendorsAuthController, VendorsController],
  providers: [VendorsService],
  exports: [VendorsService],
})
export class VendorsModule {}
