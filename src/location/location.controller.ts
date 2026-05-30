import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LocationService } from './location.service';
import { GetCitiesDto, GetCountriesDto, GetStatesDto } from './dto';

@ApiTags('Location')
@Controller('location')
export class LocationController {
  constructor(private readonly locationService: LocationService) {}

  @Get('countries')
  getAllCountries(@Query() query: GetCountriesDto) {
    return this.locationService.getCountries(query.search);
  }

  @Get('states')
  getStates(@Query() query: GetStatesDto) {
    return this.locationService.getStates(query.countryCode, query.search);
  }

  @Get('cities')
  getCities(@Query() query: GetCitiesDto) {
    return this.locationService.getCities(
      query.countryCode,
      query.stateCode,
      query.search,
    );
  }

  @Get('areas')
  getAreas(@Query('city') city: string) {
    return this.locationService.getAreas(123);
  }
}
