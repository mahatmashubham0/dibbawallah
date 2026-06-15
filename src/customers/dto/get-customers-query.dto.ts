import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsBoolean, IsDateString } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { CustomerStatus, MealType, SubscriptionStatus } from '@prisma/client';
import { SearchablePaginatedDto } from '@Common';

export class GetCustomersQueryDto extends SearchablePaginatedDto {
  @ApiPropertyOptional({ enum: CustomerStatus })
  @IsOptional()
  @IsEnum(CustomerStatus)
  status?: CustomerStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  vendorId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  mealPlanId?: number;

  @ApiPropertyOptional({ enum: MealType })
  @IsOptional()
  @IsEnum(MealType)
  mealType?: MealType;

  @ApiPropertyOptional({ description: 'Filter by join date start (ISO string)' })
  @IsOptional()
  @IsDateString()
  joinedStartDate?: string;

  @ApiPropertyOptional({ description: 'Filter by join date end (ISO string)' })
  @IsOptional()
  @IsDateString()
  joinedEndDate?: string;

  @ApiPropertyOptional({ enum: SubscriptionStatus })
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  subscriptionStatus?: SubscriptionStatus;
}
