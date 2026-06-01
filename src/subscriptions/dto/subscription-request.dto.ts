import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionRequestStatus } from '@prisma/client';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateSubscriptionRequestDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  planId!: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  paymentProofUrl!: string;
}

export class RespondToSubscriptionRequestDto {
  @ApiProperty({ enum: SubscriptionRequestStatus })
  @IsNotEmpty()
  @IsEnum(SubscriptionRequestStatus)
  status!: SubscriptionRequestStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  declineReason?: string;
}
