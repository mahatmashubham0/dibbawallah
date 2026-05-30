import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GetCitiesDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  countryCode: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  stateCode: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}
