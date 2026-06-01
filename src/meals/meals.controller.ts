import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { MealsService } from './meals.service';
import { CreateMealDto, UpdateMealDto } from './dto';
import { ApiTags } from '@nestjs/swagger';
import {
  AccessGuard,
  AuthenticatedRequest,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  UserType,
} from '@Common';

@ApiTags('Meals')
@UseGuards(JwtAuthGuard, AccessGuard)
@Roles(UserType.Vendor)
@UseGuards(RolesGuard)
@Controller('meals')
export class MealsController {
  constructor(private readonly mealsService: MealsService) { }

  @Post()
  create(@Body() data: CreateMealDto, @Req() req: AuthenticatedRequest) {
    return this.mealsService.createMeal({
      vendorId: req.user.id,
      name: data.name,
      mealType: data.mealType,
      price: data.price,
      totalTifin: data.totalTifin,
      description: data.description,
    });
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: UpdateMealDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.mealsService.updateMeal(id, {
      vendorId: req.user.id,
      name: data.name,
      price: data.price,
      totalTifin: data.totalTifin,
      description: data.description,
    });
  }

  @Get('vendor/:vendorId')
  getVendorMeals(
    @Param('vendorId', ParseIntPipe)
    vendorId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.mealsService.getVendorMeals(req.user.id);
  }

  @Get(':id')
  getMealById(
    @Param('id', ParseIntPipe)
    id: number,
  ) {
    return this.mealsService.getMealById(id);
  }

  @Get(':id/versions')
  getVersions(
    @Param('id', ParseIntPipe)
    id: number,
  ) {
    return this.mealsService.getMealVersions(id);
  }
}
