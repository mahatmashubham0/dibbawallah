import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class SearchStatesRequestDto {
  @ApiPropertyOptional({ example: 'madhya' })
  @IsOptional()
  @IsString()
  search?: string;
}
