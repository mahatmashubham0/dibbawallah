import * as Papa from 'papaparse';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigType } from '@nestjs/config';
import {
  CustomerStatus,
  OtpTransport,
  PaymentRequestType,
  PaymentStatus,
  Prisma,
  SubscriptionStatus,
  VendorCustomer,
  Vendor,
  PriceType,
  LocationOwnerType,
} from '@prisma/client';
import { appConfigFactory, userConfigFactory } from '@Config';
import {
  JwtPayload,
  UserType,
  UtilsService,
  getAccessGuardCacheKey,
} from '@Common';
import { OtpContext, OtpService, SendCodeResponse } from '../otp';
import { PrismaService } from '../prisma';
import { MealType, VendorRecord, VendorStatus } from './types';
import { LocationService } from 'src/location';
import { WalletService } from '../wallet/wallet.service';
import { AddCustomerDto } from './dto';

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
    @Inject(userConfigFactory.KEY)
    private readonly config: ConfigType<typeof userConfigFactory>,
    @Inject(appConfigFactory.KEY)
    private readonly appConfig: ConfigType<typeof appConfigFactory>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly prisma: PrismaService,
    private readonly utilsService: UtilsService,
    private readonly otpService: OtpService,
    private readonly jwtService: JwtService,
    private readonly locationService: LocationService,
    private readonly walletService: WalletService,
  ) { }

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
        Prisma.sql`SELECT id FROM vendor_meta WHERE invite_code = ${inviteCode} LIMIT 1`,
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
      mealsOffered: (row.mealsOffered || []).map((meal) =>
        meal.toLowerCase(),
      ) as MealType[],
      status: row.status.toLowerCase() as VendorStatus,
    };
  }

  private vendorSelectSql() {
    return Prisma.sql`
    SELECT
      v.id AS id,
      v.business_name AS "businessName",
      v.full_name AS "fullName",
      v.dial_code AS "dialCode",
      v.mobile,
      a.name AS "locality",
      vpp.upi_id AS "upiId",
      vm.invite_code AS "inviteCode",
      v.status,
      v.created_at AS "createdAt",
      v.updated_at AS "updatedAt",
      (
        SELECT COALESCE(array_agg(sa_a.name), ARRAY[]::text[])
        FROM vendor_service_area vsa
        JOIN area sa_a ON sa_a.id = vsa.area_id
        WHERE vsa.vendor_id = v.id
      ) AS "serviceAreas",
      (
        SELECT COALESCE(array_agg(m.name), ARRAY[]::text[])
        FROM meal m
        WHERE m.vendor_id = v.id
          AND m.is_active = TRUE
      ) AS "mealsOffered"
    FROM vendor v
    LEFT JOIN vendor_meta vm
      ON vm.vendor_id = v.id
    LEFT JOIN vendor_payment_profile vpp
      ON vpp.vendor_id = v.id
    LEFT JOIN locations l
      ON l.owner_id = v.id AND l.owner_type = 'vendor'
    LEFT JOIN area a
      ON a.id = l.area_id
  `;
  }

  private async findVendorByClause(
    clause: Prisma.Sql,
  ): Promise<VendorRecord | null> {
    const rows = await this.prisma.$queryRaw<VendorRecord[]>(
      Prisma.sql`
        SELECT * FROM (
          ${this.vendorSelectSql()}
        ) AS subquery
        ${clause}
        LIMIT 1
      `,
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
    console.log("normalizedMobile", mobile)
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

  private hashPassword(password: string): { salt: string; hash: string } {
    const salt = this.utilsService.generateSalt(this.config.passwordSaltLength);
    const hash = this.utilsService.hashPassword(
      password,
      salt,
      this.config.passwordHashLength,
    );
    return { salt, hash };
  }

  async create(data: {
    mobile: string;
    password: string;
    businessName: string;
    fullName: string;
    locality: string;
    serviceAreas: string[];
    upiId?: string;
    qrCode?: string;
    country: string;
    state: string;
    city: string;
  }): Promise<Vendor> {
    const existing = await this.prisma.vendor.findUnique({
      where: {
        mobile: data.mobile,
      },
    });

    if (existing) {
      throw new BadRequestException('Vendor mobile already exists');
    }

    if (!data.qrCode && !data.upiId) {
      throw new Error("payment details required")
    }

    let passwordSalt = null;
    let passwordHash = null;
    if (data.password) {
      const { salt, hash } = this.hashPassword(data.password);
      passwordSalt = salt;
      passwordHash = hash;
    }

    return this.prisma.$transaction(async (tx) => {
      const inviteCode = await this.generateInviteCode(tx);
      const vendor = await tx.vendor.create({
        data: {
          mobile: data.mobile,
          businessName: data.businessName,
          fullName: data.fullName,
        },
      });
      console.log("data", data)

      await tx.vendorMeta.create({
        data: {
          vendorId: vendor.id,
          passwordSalt: passwordSalt,
          passwordHash: passwordHash,
          inviteCode,
        },
      });

      if (data.upiId) {
        await tx.vendorPaymentProfile.create({
          data: {
            vendorId: vendor.id,
            upiId: data.upiId,
          },
        });
      }

      const vendorArea = await this.locationService.getOrCreateHierarchy(
        tx,
        data.country,
        data.state,
        data.city,
        data.locality,
      );

      await tx.location.create({
        data: {
          ownerId: vendor.id,
          ownerType: LocationOwnerType.Vendor,
          areaId: vendorArea.area.id,
        },
      });

      const serviceAreas = await Promise.all(
        data.serviceAreas.map((area) =>
          this.locationService.getOrCreateHierarchy(
            tx,
            data.country,
            data.state,
            data.city,
            area,
          ),
        ),
      );

      await tx.vendorServiceArea.createMany({
        data: serviceAreas.map((x) => ({
          vendorId: vendor.id,
          areaId: x.area.id,
        })),
        skipDuplicates: true,
      });

      return vendor;
    });
  }

  async register(data: {
    mobile: string;
    password: string;
    businessName: string;
    fullName: string;
    locality: string;
    serviceAreas: string[];
    upiId?: string;
    qrCode?: string;
    country: string;
    state: string;
    city: string;
  }): Promise<VendorAuthResponse> {
    // await this.verifyOtp(data.mobile, data.otpCode);
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

  async login(mobile: string, password: string): Promise<VendorAuthResponse> {
    const vendor = await this.getByMobile(mobile);
    if (!vendor) {
      throw new UnauthorizedException('Vendor does not exist');
    }
    if (vendor.status !== VendorStatus.Active) {
      throw new UnauthorizedException(
        'Your vendor account has been temporarily suspended',
      );
    }

    const meta = await this.prisma.vendorMeta.findUnique({
      where: { vendorId: vendor.id },
      select: {
        passwordSalt: true,
        passwordHash: true,
      },
    });

    if (!meta || !meta.passwordHash || !meta.passwordSalt) {
      throw new UnauthorizedException('Incorrect password');
    }

    const hash = this.utilsService.hashPassword(
      password,
      meta.passwordSalt,
      this.config.passwordHashLength,
    );

    if (hash !== meta.passwordHash) {
      throw new UnauthorizedException('Incorrect password');
    }

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
      fullName?: string;
      country?: string;
      state?: string;
      city?: string;
      vendorArea?: string;
      serviceAreas?: string[];
      upiId?: string;
      accountHolderName?: string;
      accountNumber?: string;
      ifscCode?: string;
      bankName?: string;
      qrCodeUrl?: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const vendor = await tx.vendor.findUnique({
        where: {
          id: vendorId,
        },
      });

      if (!vendor) {
        throw new NotFoundException('Vendor not found');
      }
      const vendorUpdateData: Prisma.VendorUpdateInput = {};
      if (data.businessName) {
        vendorUpdateData.businessName = this.normalizeText(data.businessName);
      }
      if (data.fullName) {
        vendorUpdateData.fullName = data.fullName;
      }

      if (Object.keys(vendorUpdateData).length > 0) {
        await tx.vendor.update({
          where: {
            id: vendorId,
          },
          data: vendorUpdateData,
        });
      }

      if (
        data.upiId !== undefined ||
        data.accountHolderName !== undefined ||
        data.accountNumber !== undefined ||
        data.ifscCode !== undefined ||
        data.bankName !== undefined ||
        data.qrCodeUrl !== undefined
      ) {
        await tx.vendorPaymentProfile.upsert({
          where: {
            vendorId,
          },
          create: {
            vendorId,
            upiId: data.upiId,
            accountHolderName: data.accountHolderName,
            accountNumber: data.accountNumber,
            ifscCode: data.ifscCode,
            bankName: data.bankName,
            qrCodeUrl: data.qrCodeUrl,
          },
          update: {
            ...(data.upiId !== undefined && {
              upiId: data.upiId,
            }),

            ...(data.accountHolderName !== undefined && {
              accountHolderName: data.accountHolderName,
            }),

            ...(data.accountNumber !== undefined && {
              accountNumber: data.accountNumber,
            }),

            ...(data.ifscCode !== undefined && {
              ifscCode: data.ifscCode,
            }),

            ...(data.bankName !== undefined && {
              bankName: data.bankName,
            }),

            ...(data.qrCodeUrl !== undefined && {
              qrCodeUrl: data.qrCodeUrl,
            }),
          },
        });
      }

      if (data.country && data.state && data.city && data.vendorArea) {
        const hierarchy = await this.locationService.getOrCreateHierarchy(
          tx,
          data.country,
          data.state,
          data.city,
          data.vendorArea,
        );

        const location = await tx.location.findFirst({
          where: {
            ownerId: vendorId,
            ownerType: LocationOwnerType.Vendor,
          },
        });

        if (location) {
          await tx.location.update({
            where: { id: location.id },
            data: { areaId: hierarchy.area.id },
          });
        } else {
          await tx.location.create({
            data: {
              ownerId: vendorId,
              ownerType: LocationOwnerType.Vendor,
              areaId: hierarchy.area.id,
            },
          });
        }
      }

      if (
        data.country &&
        data.state &&
        data.city &&
        data.serviceAreas?.length
      ) {
        const resolvedAreas = await Promise.all(
          data.serviceAreas.map((area) =>
            this.locationService.getOrCreateHierarchy(
              tx,
              data.country!,
              data.state!,
              data.city!,
              area,
            ),
          ),
        );

        const newAreaIds = resolvedAreas.map((x) => x.area.id);

        const existing = await tx.vendorServiceArea.findMany({
          where: {
            vendorId,
          },
          select: {
            areaId: true,
          },
        });

        const existingAreasIds = new Set(existing.map((x) => x.areaId));

        const incomingIds = new Set(newAreaIds);

        const toDelete = [...existingAreasIds].filter(
          (id) => !incomingIds.has(id),
        );

        const toInsert = [...incomingIds].filter(
          (id) => !existingAreasIds.has(id),
        );

        if (toDelete.length) {
          await tx.vendorServiceArea.deleteMany({
            where: {
              vendorId,
              areaId: {
                in: toDelete,
              },
            },
          });
        }

        if (toInsert.length) {
          await tx.vendorServiceArea.createMany({
            data: toInsert.map((areaId) => ({
              vendorId,
              areaId,
            })),
            skipDuplicates: true,
          });
        }
      }

      return this.getProfile(vendorId);
    });
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

  async addCustomer(
    vendorId: number,
    data: AddCustomerDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Find user by mobile
      const user = await tx.user.findFirst({ where: { mobile: data.mobile } });

      // Find or create customer
      let customer = await tx.customer.findFirst({
        where: { mobileNumber: data.mobile },
      });
      if (!customer) {
        customer = await tx.customer.create({
          data: {
            fullName: data.fullName,
            mobileNumber: data.mobile,
            address: data.address,
            userId: user ? user.id : null,
            status: CustomerStatus.UnRegistered,
          },
        });
      } else {
        customer = await tx.customer.update({
          where: { id: customer.id },
          data: {
            address: data.address || customer.address,
            userId: user ? user.id : customer.userId,
          },
        });
      }

      // Link to vendor
      let vendorCustomer = await tx.vendorCustomer.findFirst({
        where: { vendorId, customerId: customer.id },
      });

      if (!vendorCustomer) {
        vendorCustomer = await tx.vendorCustomer.create({
          data: {
            vendorId,
            customerId: customer.id,
          },
        });
      }

      if (!data.mealPlanId) {
        return customer;
      }

      // Create Subscription if Meal Plan provided
      if (data.mealPlanId) {
        const plan = await tx.mealPlan.findFirst({
          where: {
            id: data.mealPlanId,
            vendorId,
          },
          include: {
            currentVersion: {
              include: { prices: true },
            },
          },
        });

        if (!plan?.currentVersionId) {
          throw new Error("Meal plan not found");
        }

        if (plan && plan.currentVersionId && plan.currentVersion) {
          const existingSub = await tx.subscription.findFirst({
            where: {
              vendorCustomerId: vendorCustomer.id,
              planVersionId: plan.currentVersionId,
            },
          });

          if (!existingSub) {
            const price =
              plan.currentVersion.prices.find(
                (p) => p.priceType === PriceType.Monthly,
              )?.amount ??
              0;

            const amountPaid = data.amountPaid !== undefined ? data.amountPaid : Number(price);
            const totalTiffins = plan.currentVersion.totalTiffins || 30;
            const consumed = data.mealsConsumed ?? 0;

            // Calculate credits corresponding to the paid amount
            const perCreditValue = Number(price) > 0 ? (Number(price) / totalTiffins) : 0;
            const allocatedCredits = perCreditValue > 0 ? Math.round(amountPaid / perCreditValue) : totalTiffins;
            const balanceCredits = allocatedCredits - consumed;

            const paymentRequest = await tx.paymentRequest.create({
              data: {
                vendorCustomerId: vendorCustomer.id,
                vendorId,
                planVersionId: plan.currentVersionId,
                requestType: PaymentRequestType.NewSubscription,
                amount: amountPaid,
                paymentDate: new Date(),
                source: 'Migration',
                paymentMethod: 'Cash',
                status: PaymentStatus.Verified,
              },
            });

            const sub = await tx.subscription.create({
              data: {
                vendorId,
                paymentRequestId: paymentRequest.id,
                planVersionId: plan.currentVersionId,
                vendorCustomerId: vendorCustomer.id,
                status: SubscriptionStatus.Active,
                startDate: new Date(),
                amountPaid: amountPaid,
                mealsConsumed: data.mealsConsumed || 0,
              },
            });

            await this.walletService.rechargeWallet(
              vendorCustomer.id,
              {
                credits: balanceCredits,
                description: `Initial credits from imported plan: ${plan.name} (Paid: ₹${amountPaid}, allocated: ${allocatedCredits}, consumed: ${data.mealsConsumed || 0})`,
              },
              tx,
            );

            // Schedule first delivery
            // await this.walletService.scheduleDelivery(
            //   sub.id,
            //   new Date(),
            //   'Lunch',
            // );
          }
        }
      }

      return customer;
    });
  }

  async importCustomers(
    vendorId: number,
    fileBuffer: Buffer,
  ) {
    const csvData = fileBuffer.toString('utf8');

    const parsed = Papa.parse(csvData, {
      header: true,
      skipEmptyLines: true,
    });

    if (parsed.errors.length > 0) {
      return {
        success: false,
        message: parsed.errors[0].message,
        processed: 0,
        successCount: 0,
        failedCount: 0,
        results: [],
      };
    }

    const rows = parsed.data as any[];

    const mealPlans = await this.prisma.mealPlan.findMany({
      where: { vendorId },
      select: {
        id: true,
        name: true,
      },
    });

    const mealPlanMap = new Map(
      mealPlans.map((p) => [
        p.name.trim().toLowerCase(),
        p.id,
      ]),
    );

    const seenMobiles = new Set<string>();

    const results: any[] = [];

    let successCount = 0;
    let failedCount = 0;

    for (const row of rows) {
      try {
        const fullName =
          row['Name'] ||
          row['name'] ||
          row['Customer Name'];

        let mobile =
          row['Phone'] ||
          row['phone'] ||
          row['Mobile'] ||
          row['mobile'] ||
          row['Customer Number'];

        const address =
          row['Address'] ||
          row['address'] ||
          row['Customer Address'];

        const mealPlanName =
          row['Meal Plan'] ||
          row['meal plan'] ||
          row['Meal plan'];

        mobile = String(mobile || '')
          .replace(/\D/g, '')
          .trim();

        if (!fullName || !mobile) {
          failedCount++;

          results.push({
            customer: fullName || 'Unknown',
            mobile,
            status: 'Failed',
            reason: 'Missing name or mobile',
          });

          continue;
        }

        if (seenMobiles.has(mobile)) {
          failedCount++;

          results.push({
            customer: fullName,
            mobile,
            status: 'Failed',
            reason: 'Duplicate mobile in CSV',
          });

          continue;
        }

        seenMobiles.add(mobile);

        const mealsConsumed = Number(
          row['Total Meals Consumed'] ||
          row['total meals consumed'] ||
          row['Total Meal Consumed'] ||
          0,
        );

        const amountPaidRaw =
          row['Amount Paid'] ||
          row['amount paid'] ||
          row['AmountPaid'] ||
          row['Payment'] ||
          row['payment'];

        const amountPaid =
          amountPaidRaw !== undefined &&
            amountPaidRaw !== ''
            ? Number(amountPaidRaw)
            : undefined;

        let mealPlanId: number | undefined;

        if (mealPlanName) {
          mealPlanId = mealPlanMap.get(
            mealPlanName.trim().toLowerCase(),
          );

          if (!mealPlanId) {
            failedCount++;

            results.push({
              customer: fullName,
              mobile,
              status: 'Failed',
              reason: `Meal plan "${mealPlanName}" not found`,
            });

            continue;
          }
        }

        await this.addCustomer(vendorId, {
          fullName,
          mobile,
          address,
          mealPlanId,
          mealsConsumed:
            Number.isFinite(mealsConsumed)
              ? mealsConsumed
              : 0,
          amountPaid:
            amountPaid !== undefined &&
              Number.isFinite(amountPaid)
              ? amountPaid
              : undefined,
        });

        successCount++;

        results.push({
          customer: fullName,
          mobile,
          status: 'Success',
        });
      } catch (error: any) {
        failedCount++;

        results.push({
          customer:
            row['Name'] ||
            row['name'] ||
            'Unknown',
          mobile:
            row['Phone'] ||
            row['phone'] ||
            row['Mobile'] ||
            '',
          status: 'Failed',
          reason:
            error?.message ||
            'Unable to import customer',
        });
      }
    }

    return {
      success: true,
      processed: rows.length,
      successCount,
      failedCount,
      results,
    };
  }


  async getAllVendors(options?: {
    search?: string;
    skip?: number;
    take?: number;
  }): Promise<{
    count: number;
    skip: number;
    take: number;
    data: Vendor[];
  }> {
    const search = options?.search?.trim();
    const pagination = { skip: options?.skip || 0, take: options?.take || 10 };
    const where: Prisma.VendorWhereInput = {};
    if (search) {
      const buildSearchFilter = (search: string): Prisma.VendorWhereInput[] => [
        {
          fullName: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          businessName: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          mobile: {
            contains: search,
            mode: 'insensitive',
          },
        },
      ];
      const parts = search.split(' ');
      if (parts.length !== 0) {
        where.AND = [];
        for (const part of parts) {
          if (part.trim()) {
            where.AND.push({
              OR: buildSearchFilter(part.trim()),
            });
          }
        }
      }
    }

    const totalVendors = await this.prisma.vendor.count({
      where,
    });
    const vendors = await this.prisma.vendor.findMany({
      where,
      orderBy: { id: Prisma.SortOrder.asc },
      skip: pagination.skip,
      take: pagination.take,
    });

    return {
      count: totalVendors,
      skip: pagination.skip,
      take: pagination.take,
      data: vendors,
    };
  }
}
