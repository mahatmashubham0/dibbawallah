import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RefundStatus, PauseRequestStatus } from '@prisma/client';
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

export class CreateRefundRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  subscriptionId?: number;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  remark?: string;
}

export class GetPauseRequestsQueryDto {
  @ApiPropertyOptional({ enum: PauseRequestStatus })
  @IsOptional()
  @IsEnum(PauseRequestStatus)
  status?: PauseRequestStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  skip?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  take?: number;
}

export class GetRefundRequestsQueryDto {
  @ApiPropertyOptional({ enum: RefundStatus })
  @IsOptional()
  @IsEnum(RefundStatus)
  status?: RefundStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  skip?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  take?: number;
}

export class RespondToPauseRequestDto {
  @ApiProperty({ enum: PauseRequestStatus })
  @IsNotEmpty()
  @IsEnum(PauseRequestStatus)
  status!: PauseRequestStatus;
}
