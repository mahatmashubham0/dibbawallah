import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class AddCustomerDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  fullName!: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  mobile!: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  address?: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  mealPlanName?: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  mealsConsumed?: number;
}
