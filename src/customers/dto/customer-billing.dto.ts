import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum BillingAction {
  PlanChange = 'PlanChange',
  PlanUpgrade = 'PlanUpgrade',
  Recharge = 'Recharge',
  Renewal = 'Renewal',
  ManualAdjustment = 'ManualAdjustment',
}

export class CustomerBillingDto {
  @ApiProperty({ enum: BillingAction })
  @IsEnum(BillingAction)
  action!: BillingAction;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  vendorId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  planVersionId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({ description: 'Credits to add or adjust' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  credits?: number;

  @ApiPropertyOptional({ description: 'Directly set total credits' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  totalCredits?: number;

  @ApiPropertyOptional({ description: 'Directly set used credits' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  usedCredits?: number;
}
