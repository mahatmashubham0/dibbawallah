import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  SearchAreasRequestDto,
  SearchCitiesRequestDto,
  SearchStatesRequestDto,
} from './dto';
import { LocationsService } from './locations.service';

@ApiTags('Locations')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get('states')
  async searchStates(@Query() query: SearchStatesRequestDto) {
    return await this.locationsService.searchStates(query.search);
  }

  @Get('cities')
  async searchCities(@Query() query: SearchCitiesRequestDto) {
    return await this.locationsService.searchCities(
      query.search,
      query.stateId,
    );
  }

  @Get('areas')
  async searchAreas(@Query() query: SearchAreasRequestDto) {
    return await this.locationsService.searchAreas(
      query.search,
      query.cityId,
      query.take,
    );
  }
}
