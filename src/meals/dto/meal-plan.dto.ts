import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

import { PriceType } from '@prisma/client';

export class MealItemDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isOptional?: boolean;
}

export class mealMeta {
  @ApiProperty({
    example: '13:00',
    description: 'Delivery time in HH:mm format',
  })
  @IsNotEmpty()
  @IsString()
  deliveryTime!: string;

  @ApiProperty({
    example: 120,
    description: 'Cancellation cutoff in minutes before delivery',
  })
  @IsNotEmpty()
  @IsInt()
  @Min(0)
  cancellationCutoffMinutes!: number;
}

export class CreateMealDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  name!: string;

  @ApiProperty({
    type: mealMeta,
  })
  @ValidateNested()
  @Type(() => mealMeta)
  mealMeta!: mealMeta;

  @ApiPropertyOptional({
    type: [MealItemDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MealItemDto)
  items?: MealItemDto[];
}

export class UpdateMealDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    type: mealMeta,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => mealMeta)
  mealMeta?: mealMeta;

  @ApiPropertyOptional({
    type: [MealItemDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MealItemDto)
  items?: MealItemDto[];
}

export class MealPlanPriceDto {
  @ApiProperty({ enum: PriceType })
  @IsNotEmpty()
  @IsEnum(PriceType)
  priceType!: PriceType;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  amount!: number;
}

export class CreateMealPlanDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  @Min(0)
  totalTiffins!: number;

  @ApiProperty({ type: [Number] })
  @IsNotEmpty()
  @IsArray()
  @IsInt({ each: true })
  meals!: number[];

  @ApiProperty({ type: [MealPlanPriceDto] })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MealPlanPriceDto)
  prices!: MealPlanPriceDto[];
}

export class UpdateMealPlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  totalTiffins?: number;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  meals?: number[];

  @ApiPropertyOptional({ type: [MealPlanPriceDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MealPlanPriceDto)
  prices?: MealPlanPriceDto[];
}
