import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { MealType } from '../types';

export class UpdateVendorProfileRequestDto {
  @ApiPropertyOptional({ example: 'Sharma Tiffins' })
  @IsOptional()
  @IsString()
  businessName?: string;

  @ApiPropertyOptional({ example: 'Indiranagar' })
  @IsOptional()
  @IsString()
  locality?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['Indiranagar', 'Domlur'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  serviceAreas?: string[];

  @ApiPropertyOptional({
    enum: MealType,
    isArray: true,
    example: [MealType.Breakfast, MealType.Dinner],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(MealType, { each: true })
  mealsOffered?: MealType[];

  @ApiPropertyOptional({ example: 'vendor@upi' })
  @IsOptional()
  @IsString()
  upiId?: string;
}
