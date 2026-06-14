import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Customer, CustomerStatus, Prisma, VendorCustomerStatus } from '@prisma/client';
import { UserType } from '@Common';
import { PrismaService } from '../prisma';
import { GetCustomersQueryDto, UpdateCustomerDto } from './dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) { }

  async getAll(
    query: GetCustomersQueryDto,
    loggedInUser: { id: number; type: UserType },
  ): Promise<{
    count: number;
    skip: number;
    take: number;
    data: any[];
  }> {
    const isVendor = loggedInUser.type === UserType.Vendor;
    const targetVendorId = isVendor ? loggedInUser.id : query.vendorId;

    const where: Prisma.CustomerWhereInput = {};

    // 1. Scoped Vendor linking
    if (targetVendorId !== undefined || query.isActive !== undefined) {
      where.vendorLinks = {
        some: {
          ...(targetVendorId !== undefined && { vendorId: targetVendorId }),
          ...(query.isActive !== undefined && { isActive: query.isActive }),
        },
      };
    }

    // 2. Status filtering
    if (query.status) {
      where.status = query.status;
    }

    // 3. Search filtering
    if (query.search) {
      const searchString = query.search.trim();
      where.OR = [
        {
          fullName: {
            contains: searchString,
            mode: 'insensitive',
          },
        },
        {
          mobileNumber: {
            contains: searchString,
            mode: 'insensitive',
          },
        },
      ];
    }

    const count = await this.prisma.customer.count({ where });
    const customers = await this.prisma.customer.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
            dialCode: true,
            mobile: true,
          },
        },
        vendorLinks: {
          where: targetVendorId !== undefined ? { vendorId: targetVendorId } : undefined,
          include: {
            vendor: {
              select: {
                id: true,
                fullName: true,
                businessName: true,
                mobile: true,
              },
            },
            wallet: true,
            subscriptions: {
              include: {
                planVersion: {
                  include: {
                    plan: true,
                    prices: true
                  },
                },
              },
            },
          },
        },
      },
      skip: query.skip || 0,
      take: query.take || 10,
      orderBy: { id: 'desc' },
    });

    return {
      count,
      skip: query.skip || 0,
      take: query.take || 10,
      data: customers,
    };
  }

  async getById(id: number, loggedInUser: { id: number; type: UserType }) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
            dialCode: true,
            mobile: true,
          },
        },
        vendorLinks: {
          include: {
            vendor: {
              select: {
                id: true,
                fullName: true,
                businessName: true,
                mobile: true,
              },
            },
            wallet: true,
            subscriptions: {
              include: {
                planVersion: {
                  include: {
                    plan: true,
                    prices: true,
                  },
                },
              },
            },
            refundRequests: true,
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    if (loggedInUser.type === UserType.Vendor) {
      const isLinked = customer.vendorLinks.some((link) => link.vendorId === loggedInUser.id);
      if (!isLinked) {
        throw new ForbiddenException('You do not have access to this customer');
      }
      // Return only the vendor's own link
      customer.vendorLinks = customer.vendorLinks.filter((link) => link.vendorId === loggedInUser.id);
    }

    return customer;
  }

  async update(
    id: number,
    data: UpdateCustomerDto,
    loggedInUser: { id: number; type: UserType },
  ) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        vendorLinks: true,
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    let targetVendorId: number | undefined;
    if (loggedInUser.type === UserType.Vendor) {
      targetVendorId = loggedInUser.id;
      const hasLink = customer.vendorLinks.some((link) => link.vendorId === loggedInUser.id);
      if (!hasLink) {
        throw new ForbiddenException('You do not have access to this customer');
      }
    } else {
      targetVendorId = data.vendorId;
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Update general customer fields
      const customerUpdateData: Prisma.CustomerUpdateInput = {};
      if (data.fullName !== undefined) {
        customerUpdateData.fullName = data.fullName;
      }
      if (data.mobileNumber !== undefined) {
        customerUpdateData.mobileNumber = data.mobileNumber;
      }
      if (data.notes !== undefined) {
        customerUpdateData.notes = data.notes;
      }
      if (data.address !== undefined) {
        customerUpdateData.address = data.address;
      }
      if (data.status !== undefined) {
        customerUpdateData.status = data.status;
      }

      if (Object.keys(customerUpdateData).length > 0) {
        await tx.customer.update({
          where: { id },
          data: customerUpdateData,
        });
      }

      // 2. Update VendorCustomer relationship if relationship fields are provided
      const hasRelationshipUpdates =
        data.vendorCustomerNotes !== undefined ||
        data.vendorCustomerStatus !== undefined ||
        data.isActive !== undefined;

      if (hasRelationshipUpdates) {
        if (!targetVendorId) {
          throw new BadRequestException('vendorId is required to update vendor-customer relationship details');
        }

        const link = await tx.vendorCustomer.findUnique({
          where: {
            vendorId_customerId: {
              vendorId: targetVendorId,
              customerId: id,
            },
          },
        });

        if (!link) {
          throw new NotFoundException(`VendorCustomer link not found for vendor ${targetVendorId} and customer ${id}`);
        }

        await tx.vendorCustomer.update({
          where: { id: link.id },
          data: {
            ...(data.vendorCustomerNotes !== undefined && { notes: data.vendorCustomerNotes }),
            ...(data.vendorCustomerStatus !== undefined && { status: data.vendorCustomerStatus }),
            ...(data.isActive !== undefined && { isActive: data.isActive }),
          },
        });
      }

      // Return the updated customer details
      return this.getById(id, loggedInUser);
    });
  }
}
