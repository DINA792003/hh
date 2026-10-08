import type { Prisma } from '@prisma/client';
import { prisma } from '@dct-crm/db';

type Db = Prisma.TransactionClient | typeof prisma;

export interface CreateEnquiryInput {
  tenantId: string;
  leadId: string;
  leadType: string;
  enquiryType: string;
  source: string;
  subSource?: string | null;
  campaignId?: string | null;
  campaign?: string | null;
  subCampaignId?: string | null;
  subCampaign?: string | null;
  projectId?: string | null;
  phone?: string | null;
  secondaryPhone?: string | null;
  tertiaryPhone?: string | null;
  countryCode?: string | null;
  secondaryCountryCode?: string | null;
  email?: string | null;
  secondaryEmail?: string | null;
  medium?: string | null;
  description?: string | null;
  channelPartner?: string | null;
  details?: Prisma.InputJsonValue;
  enquiryDate?: Date;
  userId: string;
}

function inferCountryCode(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return '91';
  return digits.length > 10 ? digits.slice(0, digits.length - 10) : null;
}

async function nextEnquiryNumber(db: Db, tenantId: string): Promise<string> {
  const latest = await db.enquiry.findFirst({
    where: { tenantId },
    orderBy: { enquiryNumber: 'desc' },
    select: { enquiryNumber: true },
  });
  const latestNumber = Number(latest?.enquiryNumber.match(/^ENQ-(\d+)$/)?.[1] || 100000);
  const sequence = await db.sequence.upsert({
    where: { tenantId_type: { tenantId, type: 'ENQUIRY' } },
    update: { nextValue: { increment: 1 } },
    create: { tenantId, type: 'ENQUIRY', nextValue: Math.max(100000, latestNumber) + 1 },
  });
  return `ENQ-${String(sequence.nextValue).padStart(6, '0')}`;
}

export async function createEnquiryInTransaction(
  db: Prisma.TransactionClient,
  input: CreateEnquiryInput,
) {
  const enquiryNumber = await nextEnquiryNumber(db, input.tenantId);
  return db.enquiry.create({
    data: {
      enquiryNumber,
      tenantId: input.tenantId,
      leadId: input.leadId,
      leadType: input.leadType,
      enquiryType: input.enquiryType,
      source: input.source,
      subSource: input.subSource || null,
      campaignId: input.campaignId || null,
      campaign: input.campaign || null,
      subCampaignId: input.subCampaignId || null,
      subCampaign: input.subCampaign || null,
      projectId: input.projectId || null,
      phone: input.phone || null,
      secondaryPhone: input.secondaryPhone || null,
      tertiaryPhone: input.tertiaryPhone || null,
      countryCode: input.countryCode || inferCountryCode(input.phone),
      secondaryCountryCode: input.secondaryCountryCode || inferCountryCode(input.secondaryPhone),
      email: input.email || null,
      secondaryEmail: input.secondaryEmail || null,
      medium: input.medium || null,
      description: input.description || null,
      channelPartner: input.channelPartner || null,
      details: input.details,
      enquiryDate: input.enquiryDate,
      createdById: input.userId,
      updatedById: input.userId,
    },
    include: { project: { select: { id: true, name: true } } },
  });
}

export async function getLeadEnquiries(
  tenantId: string,
  leadId: string,
  page: number,
  limit: number,
) {
  const where = { tenantId, leadId };
  const [data, total] = await Promise.all([
    prisma.enquiry.findMany({
      where,
      include: { project: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: 'desc' }, { enquiryNumber: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.enquiry.count({ where }),
  ]);
  return {
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getEnquiryById(tenantId: string | undefined, enquiryId: string) {
  return prisma.enquiry.findFirst({
    where: { id: enquiryId, ...(tenantId ? { tenantId } : {}) },
    include: {
      project: { select: { id: true, name: true } },
      lead: {
        select: {
          id: true,
          tenantId: true,
          leadNumber: true,
          firstName: true,
          lastName: true,
          company: true,
          ownerId: true,
          creatorId: true,
        },
      },
    },
  });
}
