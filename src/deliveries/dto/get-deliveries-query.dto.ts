import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsInt, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { DeliveryStatus, MealType } from '@prisma/client';
import { SearchablePaginatedDto } from '@Common';

export class GetDeliveriesQueryDto extends SearchablePaginatedDto {
  @ApiPropertyOptional({
    description: 'Date in YYYY-MM-DD format to retrieve deliveries',
  })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ enum: MealType })
  @IsOptional()
  @IsEnum(MealType)
  mealType?: MealType;

  @ApiPropertyOptional({ enum: DeliveryStatus })
  @IsOptional()
  @IsEnum(DeliveryStatus)
  status?: DeliveryStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  vendorId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  lowCredit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  location?: string;
}
