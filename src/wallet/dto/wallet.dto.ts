import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RefundStatus, DeliveryStatus } from '@prisma/client';

export class ConfigureWalletDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  creditLimit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  lowCreditThreshold?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  criticalCreditThreshold?: number;
}

export class RechargeWalletDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  @Min(1)
  credits!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateRefundRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  subscriptionId?: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  @Min(1)
  credits!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ProcessRefundRequestDto {
  @ApiProperty({ enum: RefundStatus })
  @IsNotEmpty()
  @IsEnum(RefundStatus)
  status!: RefundStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  cancellationFee?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  processingFee?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  taxDeduction?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}

export class CreatePauseRequestDto {
  @ApiProperty()
  @IsNotEmpty()
  @Type(() => Date)
  startDate!: Date;

  @ApiProperty()
  @IsNotEmpty()
  @Type(() => Date)
  endDate!: Date;
}

export class UpdateDeliveryStatusDto {
  @ApiProperty({ enum: DeliveryStatus })
  @IsNotEmpty()
  @IsEnum(DeliveryStatus)
  status!: DeliveryStatus;
}
