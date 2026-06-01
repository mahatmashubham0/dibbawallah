// meal/dto/create-meal.dto.ts

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MealType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateMealDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  totalTifin!: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(MealType)
  mealType!: MealType;
}
