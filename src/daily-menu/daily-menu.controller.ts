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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
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
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('daily-menu')
export class DailyMenuController {
  constructor(private readonly dailyMenuService: DailyMenuService) {}

  @Post()
  @Roles(UserType.Vendor)
  @UseGuards(RolesGuard)
  async upsert(
    @Body() data: CreateDailyMenuDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.dailyMenuService.upsertDailyMenu(req.user.id, data);
    return { success: 'success' };
  }

  @Get()
  @Roles(UserType.Vendor)
  @UseGuards(RolesGuard)
  getVendorMenu(
    @Req() req: AuthenticatedRequest,
    @Query() query: GetDailyMenusDto,
  ) {
    return this.dailyMenuService.getVendorDailyMenus(req.user.id, query);
  }
}
