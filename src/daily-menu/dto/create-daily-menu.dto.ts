import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MealType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class DailyMenuDishDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  dishName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  displayOrder?: number;
}

export class CreateDailyMenuDto {
  @ApiProperty({ enum: MealType })
  @IsNotEmpty()
  @IsEnum(MealType)
  mealType!: MealType;

  @ApiProperty({ example: '2026-06-01' })
  @IsNotEmpty()
  @IsDateString()
  menuDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  specialNote?: string;

  @ApiProperty({ type: [DailyMenuDishDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DailyMenuDishDto)
  dishes!: DailyMenuDishDto[];
}
