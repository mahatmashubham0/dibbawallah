import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GetStatesDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  countryCode: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}
