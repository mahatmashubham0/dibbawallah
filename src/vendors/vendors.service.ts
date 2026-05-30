import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigType } from '@nestjs/config';
import { OtpTransport, Prisma } from '@prisma/client';
import { appConfigFactory } from '@Config';
import {
  JwtPayload,
  UserType,
  UtilsService,
  getAccessGuardCacheKey,
} from '@Common';
import { OtpContext, OtpService, SendCodeResponse } from '../otp';
import { PrismaService } from '../prisma';
import { MealType, VendorRecord, VendorStatus } from './types';

export type VendorAuthResponse = {
  accessToken: string;
  type: UserType.Vendor;
  vendor: Awaited<ReturnType<VendorsService['getProfile']>>;
};

type InviteAssets = {
  inviteCode: string;
  inviteLink: string;
  whatsappShareUrl: string;
  qrCodeUrl: string;
  qrCodeDataUrl: string | null;
};

@Injectable()
export class VendorsService {
  private readonly vendorOtpConfig = {
    length: 4,
    resendCooldown: 30000,
    expiration: 300000,
  };

  constructor(
    @Inject(appConfigFactory.KEY)
    private readonly appConfig: ConfigType<typeof appConfigFactory>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly prisma: PrismaService,
    private readonly utilsService: UtilsService,
    private readonly otpService: OtpService,
    private readonly jwtService: JwtService,
  ) {}

  private generateJwt(payload: JwtPayload): string {
    return this.jwtService.sign(payload);
  }

  private normalizeText(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
  }

  private normalizeAreas(areas: string[]): string[] {
    const normalized = areas.map((area) => this.normalizeText(area));
    return [...new Set(normalized)];
  }

  private buildInviteLink(inviteCode: string): string {
    const baseUrl =
      this.appConfig.vendorAppWebUrl ||
      this.appConfig.appWebUrl ||
      this.appConfig.appUri ||
      this.appConfig.serverUrl ||
      'https://vendor.tifinos.app';

    return `${baseUrl.replace(/\/+$/, '')}/invite/${inviteCode}`;
  }

  private async generateInviteCode(
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const inviteCode = this.utilsService
        .generateRandomToken(10)
        .toUpperCase();
      const vendor = await tx.$queryRaw<Array<{ id: number }>>(
        Prisma.sql`SELECT id FROM vendor WHERE invite_code = ${inviteCode} LIMIT 1`,
      );
      if (vendor.length === 0) return inviteCode;
    }

    throw new Error('Unable to generate a unique invite code');
  }

  private async generateQrCodeDataUrl(text: string): Promise<string | null> {
    try {
      const QRCode = (await import('qrcode')) as {
        toDataURL(
          value: string,
          options?: Record<string, unknown>,
        ): Promise<string>;
      };
      return await QRCode.toDataURL(text, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 320,
      });
    } catch {
      return null;
    }
  }

  private mapVendor(row: VendorRecord): VendorRecord {
    return {
      ...row,
      mealsOffered: row.mealsOffered.map((meal) =>
        meal.toLowerCase(),
      ) as MealType[],
      status: row.status.toLowerCase() as VendorStatus,
    };
  }

  private vendorSelectSql() {
    return Prisma.sql`
      SELECT
        id,
        business_name AS "businessName",
        locality,
        service_areas AS "serviceAreas",
        meals_offered AS "mealsOffered",
        dial_code AS "dialCode",
        mobile,
        upi_id AS "upiId",
        invite_code AS "inviteCode",
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM vendor
    `;
  }

  private async findVendorByClause(
    clause: Prisma.Sql,
  ): Promise<VendorRecord | null> {
    const rows = await this.prisma.$queryRaw<VendorRecord[]>(
      Prisma.sql`${this.vendorSelectSql()} ${clause} LIMIT 1`,
    );

    if (rows.length === 0) return null;
    return this.mapVendor(rows[0]);
  }

  private async buildInviteAssets(
    vendor: Pick<VendorRecord, 'inviteCode' | 'businessName'>,
  ): Promise<InviteAssets> {
    const inviteLink = this.buildInviteLink(vendor.inviteCode);
    const shareText = `Join ${vendor.businessName} on TifinOS using this invite link: ${inviteLink}`;

    return {
      inviteCode: vendor.inviteCode,
      inviteLink,
      whatsappShareUrl: `https://wa.me/?text=${encodeURIComponent(shareText)}`,
      qrCodeUrl: `https://quickchart.io/qr?text=${encodeURIComponent(inviteLink)}&size=320`,
      qrCodeDataUrl: await this.generateQrCodeDataUrl(inviteLink),
    };
  }

  async isMobileExist(
    mobile: string,
    excludeVendorId?: number,
  ): Promise<boolean> {
    const exclusion = excludeVendorId
      ? Prisma.sql`AND id <> ${excludeVendorId}`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM vendor
        WHERE mobile = ${mobile}
        ${exclusion}
      `,
    );
    return Number(rows[0]?.count || 0) > 0;
  }

  async getById(vendorId: number): Promise<VendorRecord> {
    const vendor = await this.findVendorByClause(
      Prisma.sql`WHERE id = ${vendorId}`,
    );
    if (!vendor) {
      throw new Error('Vendor not found');
    }
    return vendor;
  }

  async getByMobile(mobile: string): Promise<VendorRecord | null> {
    return await this.findVendorByClause(Prisma.sql`WHERE mobile = ${mobile}`);
  }

  async sendOtp(mobile: string): Promise<SendCodeResponse> {
    return await this.otpService.send(
      {
        context: OtpContext.VendorAuth,
        target: mobile,
        transport: OtpTransport.Mobile,
      },
      this.vendorOtpConfig,
    );
  }

  async verifyOtp(mobile: string, otpCode: string) {
    const response = await this.otpService.verify(
      otpCode,
      mobile,
      OtpTransport.Mobile,
      {
        expiration: this.vendorOtpConfig.expiration,
      },
    );

    if (!response.status) {
      throw new UnauthorizedException('Incorrect verification code');
    }
  }

  async create(data: {
    mobile: string;
    businessName: string;
    locality: string;
    serviceAreas: string[];
    mealsOffered: MealType[];
    upiId?: string;
  }): Promise<VendorRecord> {
    if (await this.isMobileExist(data.mobile)) {
      throw new Error('Vendor mobile already exists');
    }

    return await this.prisma.$transaction(async (tx) => {
      const inviteCode = await this.generateInviteCode(tx);
      const normalizedBusinessName = this.normalizeText(data.businessName);
      const normalizedLocality = this.normalizeText(data.locality);
      const normalizedAreas = this.normalizeAreas(data.serviceAreas);
      const normalizedUpiId = data.upiId
        ? this.normalizeText(data.upiId)
        : null;

      const rows = await tx.$queryRaw<VendorRecord[]>(
        Prisma.sql`
          INSERT INTO vendor (
            business_name,
            locality,
            service_areas,
            meals_offered,
            dial_code,
            mobile,
            upi_id,
            invite_code,
            status
          )
          VALUES (
            ${normalizedBusinessName},
            ${normalizedLocality},
            ARRAY[${Prisma.join(normalizedAreas)}]::text[],
            ARRAY[${Prisma.join(
              data.mealsOffered.map((meal) => Prisma.sql`${meal}::meal_type`),
            )}]::meal_type[],
            '+91',
            ${data.mobile},
            ${normalizedUpiId},
            ${inviteCode},
            'active'::vendor_status
          )
          RETURNING
            id,
            business_name AS "businessName",
            locality,
            service_areas AS "serviceAreas",
            meals_offered AS "mealsOffered",
            dial_code AS "dialCode",
            mobile,
            upi_id AS "upiId",
            invite_code AS "inviteCode",
            status,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
        `,
      );

      return this.mapVendor(rows[0]);
    });
  }

  async register(data: {
    mobile: string;
    otpCode: string;
    businessName: string;
    locality: string;
    serviceAreas: string[];
    mealsOffered: MealType[];
    upiId?: string;
  }): Promise<VendorAuthResponse> {
    await this.verifyOtp(data.mobile, data.otpCode);
    const vendor = await this.create(data);

    return {
      accessToken: this.generateJwt({
        sub: vendor.id,
        type: UserType.Vendor,
      }),
      type: UserType.Vendor,
      vendor: await this.getProfile(vendor.id),
    };
  }

  async login(mobile: string, otpCode: string): Promise<VendorAuthResponse> {
    const vendor = await this.getByMobile(mobile);
    if (!vendor) {
      throw new UnauthorizedException('Vendor does not exist');
    }
    if (vendor.status !== VendorStatus.Active) {
      throw new UnauthorizedException(
        'Your vendor account has been temporarily suspended',
      );
    }

    await this.verifyOtp(mobile, otpCode);

    return {
      accessToken: this.generateJwt({
        sub: vendor.id,
        type: UserType.Vendor,
      }),
      type: UserType.Vendor,
      vendor: await this.getProfile(vendor.id),
    };
  }

  async getProfile(vendorId: number) {
    const vendor = await this.getById(vendorId);
    return {
      ...vendor,
      ...(await this.buildInviteAssets(vendor)),
    };
  }

  async updateProfile(
    vendorId: number,
    data: {
      businessName?: string;
      locality?: string;
      serviceAreas?: string[];
      mealsOffered?: MealType[];
      upiId?: string;
    },
  ) {
    const current = await this.getById(vendorId);
    const businessName = data.businessName
      ? this.normalizeText(data.businessName)
      : current.businessName;
    const locality = data.locality
      ? this.normalizeText(data.locality)
      : current.locality;
    const serviceAreas = data.serviceAreas
      ? this.normalizeAreas(data.serviceAreas)
      : current.serviceAreas;
    const mealsOffered = data.mealsOffered || current.mealsOffered;
    const upiId =
      data.upiId !== undefined
        ? data.upiId
          ? this.normalizeText(data.upiId)
          : null
        : current.upiId;

    await this.prisma.$executeRaw(
      Prisma.sql`
        UPDATE vendor
        SET
          business_name = ${businessName},
          locality = ${locality},
          service_areas = ARRAY[${Prisma.join(serviceAreas)}]::text[],
          meals_offered = ARRAY[${Prisma.join(
            mealsOffered.map((meal) => Prisma.sql`${meal}::meal_type`),
          )}]::meal_type[],
          upi_id = ${upiId},
          updated_at = NOW()
        WHERE id = ${vendorId}
      `,
    );

    return await this.getProfile(vendorId);
  }

  async getInvite(vendorId: number): Promise<InviteAssets> {
    const vendor = await this.getById(vendorId);
    return await this.buildInviteAssets(vendor);
  }

  async getInvitePreview(inviteCode: string) {
    const vendor = await this.findVendorByClause(
      Prisma.sql`WHERE invite_code = ${inviteCode}`,
    );
    if (!vendor) {
      throw new Error('Invite code not found');
    }

    return {
      businessName: vendor.businessName,
      locality: vendor.locality,
      serviceAreas: vendor.serviceAreas,
      mealsOffered: vendor.mealsOffered,
    };
  }

  async logout(vendorId: number): Promise<void> {
    await this.cacheManager.del(
      getAccessGuardCacheKey({ id: vendorId, type: UserType.Vendor }),
    );
  }
}
