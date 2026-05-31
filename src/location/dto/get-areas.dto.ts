// location/dto/get-areas.dto.ts

import { IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SearchablePaginatedDto } from '@Common';

export class GetAreasDto extends SearchablePaginatedDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  cityId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pincode?: string;
}
