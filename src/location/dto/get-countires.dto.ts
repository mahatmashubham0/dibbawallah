import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class GetCountriesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}
