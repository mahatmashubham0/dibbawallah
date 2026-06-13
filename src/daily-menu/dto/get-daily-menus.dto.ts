import { SearchablePaginatedDto } from '@Common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MealType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GetDailyMenusDto extends SearchablePaginatedDto {
  @ApiProperty({ example: '2026-06-01' })
  @IsNotEmpty()
  @IsString()
  date: string;

  @ApiPropertyOptional({ enum: MealType })
  @IsOptional()
  @IsEnum(MealType)
  mealType?: MealType;
}
