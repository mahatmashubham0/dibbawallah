import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { DailyMenuService } from './daily-menu.service';
import { CreateDailyMenuDto, GetDailyMenusDto } from './dto';
import { ApiTags } from '@nestjs/swagger';
import { MealType } from '@prisma/client';
import {
  AccessGuard,
  AuthenticatedRequest,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  UserType,
} from '@Common';

@ApiTags('Daily Menu')
@UseGuards(JwtAuthGuard, AccessGuard, RolesGuard)
@Controller('daily-menu')
export class DailyMenuController {
  constructor(private readonly dailyMenuService: DailyMenuService) { }

  @Post()
  @Roles(UserType.Vendor)
  upsert(@Body() data: CreateDailyMenuDto, @Req() req: AuthenticatedRequest) {
    return this.dailyMenuService.upsertDailyMenu(req.user.id, data);
  }

  @Get()
  @Roles(UserType.Vendor)
  getVendorMenu(
    @Req() req: AuthenticatedRequest,
    @Query() query: GetDailyMenusDto,
  ) {
    return this.dailyMenuService.getVendorDailyMenus(
      req.user.id,
      query,
    );
  }

}
