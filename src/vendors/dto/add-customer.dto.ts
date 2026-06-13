import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

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
