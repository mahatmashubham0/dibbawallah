import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { MealType } from '../types';

export class VendorRegisterRequestDto {
  @ApiProperty({
    example: '+919876543210',
    description: 'Indian mobile number in E.164 format',
  })
  @IsString()
  @Matches(/^\+91[6-9]\d{9}$/, {
    message:
      'The mobile number must be a valid Indian mobile number in +91 format',
  })
  mobile: string;

  @ApiProperty({ example: '1234' })
  @Matches(/^\d{4}$/)
  otpCode: string;

  @ApiProperty({ example: 'Sharma Tiffins' })
  @IsString()
  businessName: string;

  @ApiProperty({ example: 'Indiranagar' })
  @IsString()
  locality: string;

  @ApiProperty({
    type: [String],
    example: ['Indiranagar', 'Domlur'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  serviceAreas: string[];

  @ApiProperty({
    enum: MealType,
    isArray: true,
    example: [MealType.Breakfast, MealType.Lunch],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(MealType, { each: true })
  mealsOffered: MealType[];

  @ApiPropertyOptional({ example: 'vendor@upi' })
  @IsOptional()
  @IsString()
  upiId?: string;
}
