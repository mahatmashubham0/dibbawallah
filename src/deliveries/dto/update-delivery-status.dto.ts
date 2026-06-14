import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { DeliveryStatus } from '@prisma/client';

export class UpdateDeliveryStatusDto {
  @ApiProperty({ enum: DeliveryStatus })
  @IsNotEmpty()
  @IsEnum(DeliveryStatus)
  status!: DeliveryStatus;
}
