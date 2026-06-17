import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

export class AddCustomerDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  fullName!: string;

  @ApiProperty({
    example: '+919876543210',
    description: 'Indian mobile number in E.164 format',
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/^\+91[6-9]\d{9}$/, {
    message:
      'The mobile number must be a valid Indian mobile number in +91 format',
  })
  mobile!: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  address?: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  mealPlanId?: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  mealsConsumed?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  amountPaid?: number;
}
