import { Prisma } from '@prisma/client';
import { leadCreateSchema, normalizePhone } from '@dct-crm/shared';
import { prisma } from '@dct-crm/db';
import { createOwnerHistory } from './ownerHistory';
import { getNextSiteVisitNumber } from './leadWorkflowExtras';
import { createEnquiryInTransaction } from './enquiryService';
import {
  findApplicableRRQueue,
  isLeadEligibleForAutoAssignment,
  RoundRobinAssignmentService,
} from './rrQueue';

export type EnquiryAction =
  | 'NEW_LEAD'
  | 'EXISTING_ACTIVE'
  | 'RE_ENGAGED'
  | 'OUTSIDE_REENGAGEMENT_WINDOW'
  | 'DUPLICATE_CONFLICT';

export interface EnquiryMetadata {
  source: string;
  subSource?: string;
  campaign?: string;
  subCampaign?: string;
  secondaryPhone?: string;
  tertiaryPhone?: string;
  secondaryEmail?: string;
  countryCode?: string;
  secondaryCountryCode?: string;
  medium?: string;
  description?: string;
  channelPartner?: string;
  campaignId?: string;
  subCampaignId?: string;
  enquiryDate?: Date;
  details?: Record<string, unknown>;
}

type LeadCreateData = ReturnType<typeof leadCreateSchema.parse>;

const DEFAULT_REENGAGEMENT_DAYS = 25;

function settingDays(settings: unknown): number {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return DEFAULT_REENGAGEMENT_DAYS;
  }
  const value = (settings as Record<string, unknown>).reEngagementValidationDays
    ?? (settings as Record<string, unknown>).RE_ENGAGEMENT_VALIDATION_DAYS;
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : DEFAULT_REENGAGEMENT_DAYS;
}

function phoneVariants(value: string): string[] {
  const normalized = normalizePhone(value);
  const digits = normalized.replace(/\D/g, '');
  if (!digits) return [];
  const values = new Set([digits]);
  if (digits.startsWith('91') && digits.length === 12) {
    const local = digits.slice(2);
    values.add(local);
    values.add(`0${local}`);
    values.add(`0091${local}`);
  } else if (digits.length === 10) {
    values.add(`91${digits}`);
    values.add(`0${digits}`);
    values.add(`0091${digits}`);
  } else if (digits.startsWith('0') && digits.length === 11) {
    const local = digits.slice(1);
    values.add(local);
    values.add(`91${local}`);
    values.add(`0091${local}`);
  } else if (digits.startsWith('0091') && digits.length === 14) {
    const local = digits.slice(4);
    values.add(local);
    values.add(`91${local}`);
    values.add(`0${local}`);
  }
  return [...values];
}

function normalizeDateParts(date: Date, timezone: string): [number, number, number] {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return [Number(values.year), Number(values.month), Number(values.day)];
}

export function getCalendarDaysBetween(start: Date, end: Date, timezone = 'UTC'): number {
  const [startYear, startMonth, startDay] = normalizeDateParts(start, timezone);
  const [endYear, endMonth, endDay] = normalizeDateParts(end, timezone);
  return Math.floor(
    (Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(startYear, startMonth - 1, startDay)) /
    86_400_000,
  );
}

export function classifyEnquiryAction(
  status: string,
  daysSinceLost: number | null,
  validationDays: number,
): Exclude<EnquiryAction, 'DUPLICATE_CONFLICT' | 'NEW_LEAD'> {
  if (status !== 'LOST') return 'EXISTING_ACTIVE';
  return daysSinceLost !== null && daysSinceLost >= validationDays
    ? 'RE_ENGAGED'
    : 'OUTSIDE_REENGAGEMENT_WINDOW';
}

async function getMatchingLeadIds(
  tx: Prisma.TransactionClient,
  tenantId: string,
  phones: string[],
): Promise<string[]> {
  const variants = [...new Set(phones.flatMap(phoneVariants))];
  if (variants.length === 0) return [];

  const phoneFields = await tx.fieldDefinition.findMany({
    where: {
      tenantId,
      fieldType: 'phone',
      object: { name: { equals: 'Lead', mode: 'insensitive' } },
    },
    select: { name: true },
  });
  const values = Prisma.join(variants);
  const leadPhoneClauses = [
    Prisma.sql`regexp_replace(coalesce(l."phone", ''), '[^0-9]', '', 'g') IN (${values})`,
    Prisma.sql`regexp_replace(coalesce(l."mobile", ''), '[^0-9]', '', 'g') IN (${values})`,
    ...phoneFields.map(({ name }) =>
      Prisma.sql`regexp_replace(coalesce(l."customFields" ->> ${name}, ''), '[^0-9]', '', 'g') IN (${values})`,
    ),
  ];
  const enquiryPhoneClauses = [
    Prisma.sql`regexp_replace(coalesce(e."phone", ''), '[^0-9]', '', 'g') IN (${values})`,
    Prisma.sql`regexp_replace(coalesce(e."secondaryPhone", ''), '[^0-9]', '', 'g') IN (${values})`,
    Prisma.sql`regexp_replace(coalesce(e."tertiaryPhone", ''), '[^0-9]', '', 'g') IN (${values})`,
  ];
  const leadPhoneMatch = Prisma.join(leadPhoneClauses, ' OR ');
  const enquiryPhoneMatch = Prisma.join(enquiryPhoneClauses, ' OR ');
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT l."id"
    FROM "Lead" l
    WHERE l."tenantId" = ${tenantId}
      AND (
        (${leadPhoneMatch})
        OR EXISTS (
          SELECT 1
          FROM "Enquiry" e
          WHERE e."tenantId" = l."tenantId"
            AND e."leadId" = l."id"
            AND (${enquiryPhoneMatch})
        )
      )
  `);
  return rows.map((row) => row.id);
}

async function getLostDate(
  tx: Prisma.TransactionClient,
  lead: { id: string; tenantId: string; lostAt: Date | null; createdAt: Date },
): Promise<Date> {
  if (lead.lostAt) return lead.lostAt;
  const lastLostAudit = await tx.auditLog.findFirst({
    where: {
      tenantId: lead.tenantId,
      leadId: lead.id,
      newValues: { path: ['status'], equals: 'LOST' },
    },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return lastLostAudit?.createdAt || lead.createdAt;
}

async function getNextLeadNumber(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  const sequence = await tx.sequence.upsert({
    where: { tenantId_type: { tenantId, type: 'LEAD' } },
    update: { nextValue: { increment: 1 } },
    create: { tenantId, type: 'LEAD', nextValue: 1 },
  });
  return `LN${String(sequence.nextValue).padStart(6, '0')}`;
}

export function sourceEnumValue(source: string): LeadCreateData['source'] {
  const normalized = source.trim().toUpperCase().replace(/[\s-]+/g, '_');
  const allowed = new Set([
    'WEBSITE', 'REFERRAL', 'COLD_CALL', 'ADVERTISEMENT', 'WALK_IN', 'PORTAL',
    'INSTAGRAM', 'TWITTER', 'WHATSAPP', 'YOUTUBE', 'OTHER',
  ]);
  return (allowed.has(normalized) ? normalized : 'OTHER') as LeadCreateData['source'];
}

function serializeDetails(details: Record<string, unknown> | undefined): Prisma.InputJsonValue | undefined {
  if (!details) return undefined;
  return JSON.parse(JSON.stringify(details)) as Prisma.InputJsonValue;
}

export async function processLeadEnquiry(input: {
  tenantId: string;
  userId: string;
  profileName?: string | null;
  expectedLeadId?: string;
  lead: LeadCreateData;
  enquiry: EnquiryMetadata;
  siteVisit?: { projectId?: string; scheduledAt: Date; notes?: string };
}) {
  const normalizedPhone = normalizePhone(input.lead.phone);
  if (!normalizedPhone) throw new Error('PHONE_REQUIRED');
  const metadata = {
    ...input.enquiry,
    source: input.enquiry.source.trim() || input.lead.source,
    secondaryPhone: input.enquiry.secondaryPhone ? normalizePhone(input.enquiry.secondaryPhone) : undefined,
    tertiaryPhone: input.enquiry.tertiaryPhone ? normalizePhone(input.enquiry.tertiaryPhone) : undefined,
  };

  return prisma.$transaction(async (tx) => {
    const phoneLockKeys = [...new Set([
      normalizedPhone,
      ...(metadata.secondaryPhone ? [metadata.secondaryPhone] : []),
      ...(metadata.tertiaryPhone ? [metadata.tertiaryPhone] : []),
    ].flatMap(phoneVariants))].sort();
    for (const phone of phoneLockKeys) {
      const lockKey = `LEAD_ENQUIRY:${input.tenantId}:${phone}`;
      await tx.$queryRaw(Prisma.sql`
        WITH lock AS MATERIALIZED (
          SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
        )
        SELECT 1 AS locked FROM lock
      `);
    }
    for (const projectId of new Set([input.lead.projectId, input.siteVisit?.projectId].filter(Boolean))) {
      const project = await tx.project.findFirst({
        where: { id: projectId!, tenantId: input.tenantId, isActive: true },
        select: { id: true },
      });
      if (!project) throw new Error('INVALID_PROJECT');
    }
    const createSiteVisit = async (leadId: string) => {
      if (!input.siteVisit) return null;
      const siteVisitNumber = await getNextSiteVisitNumber(tx, input.tenantId);
      const siteVisit = await tx.siteVisit.create({
        data: {
          tenantId: input.tenantId,
          leadId,
          projectId: input.siteVisit.projectId || input.lead.projectId || null,
          creatorId: input.userId,
          siteVisitNumber,
          scheduledAt: input.siteVisit.scheduledAt,
          status: 'SCHEDULED',
          notes: input.siteVisit.notes,
        },
        select: { id: true, siteVisitNumber: true, projectId: true, scheduledAt: true, status: true },
      });
      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId,
          action: 'SITE_VISIT_CREATED',
          objectType: 'SiteVisit',
          objectId: siteVisit.id,
          newValues: { leadId, scheduledAt: siteVisit.scheduledAt, siteVisitNumber, source: 'GRE' },
        },
      });
      return siteVisit;
    };

    const matchingIds = await getMatchingLeadIds(tx, input.tenantId, [
      normalizedPhone,
      ...(metadata.secondaryPhone ? [metadata.secondaryPhone] : []),
      ...(metadata.tertiaryPhone ? [metadata.tertiaryPhone] : []),
    ]);
    const existingLeads = matchingIds.length
      ? await tx.lead.findMany({
          where: { tenantId: input.tenantId, id: { in: matchingIds } },
          include: {
            owner: { select: { id: true, firstName: true, lastName: true } },
            project: { select: { id: true, name: true } },
          },
        })
      : [];

    if (
      input.expectedLeadId &&
      (existingLeads.length !== 1 || existingLeads[0].id !== input.expectedLeadId)
    ) {
      return { action: 'LEAD_MISMATCH' as const, leadIds: existingLeads.map((lead) => lead.id) };
    }
    if (existingLeads.length > 1) {
      console.error('Lead enquiry phone conflict requires admin review', {
        tenantId: input.tenantId,
        leadIds: existingLeads.map((lead) => lead.id),
        phone: normalizedPhone,
        source: metadata.source,
        at: new Date().toISOString(),
      });
      return { action: 'DUPLICATE_CONFLICT' as const, leadIds: existingLeads.map((lead) => lead.id) };
    }

    const source = sourceEnumValue(metadata.source);
    const now = new Date();
    if (existingLeads.length === 1) {
      const existing = existingLeads[0];
      const tenant = await tx.tenant.findUnique({
        where: { id: input.tenantId },
        select: { settings: true, timezone: true },
      });
      const validationDays = settingDays(tenant?.settings);
      const lostDate = existing.status === 'LOST' ? await getLostDate(tx, existing) : null;
      const timezone = tenant?.timezone || 'UTC';
      const daysDifference = lostDate ? getCalendarDaysBetween(lostDate, now, timezone) : null;
      const action = classifyEnquiryAction(existing.status, daysDifference, validationDays);
      const enquiryType = action === 'RE_ENGAGED'
        ? 'RE_ENGAGED'
        : action === 'OUTSIDE_REENGAGEMENT_WINDOW'
          ? 'OUTSIDE_REENGAGEMENT_WINDOW'
          : 'ADDITIONAL';

      const updated = await tx.lead.update({
        where: { id: existing.id },
        data: {
          lastSource: metadata.source,
          lastSubSource: metadata.subSource || null,
          lastCampaign: metadata.campaign || null,
          ...(action === 'RE_ENGAGED' ? {
            status: 'NEW',
            leadType: 'RE_ENGAGED',
            lastReEngagedAt: now,
            lostAt: null,
            ownerId: input.userId,
            ...(input.lead.projectId ? { projectId: input.lead.projectId } : {}),
          } : {}),
        },
      });
      const enquiry = await createEnquiryInTransaction(tx, {
        tenantId: input.tenantId,
        leadId: existing.id,
        leadType: action === 'RE_ENGAGED' ? 'RE_ENGAGED' : 'ADDITIONAL',
        enquiryType,
        source: metadata.source,
        subSource: metadata.subSource,
        campaignId: metadata.campaignId,
        campaign: metadata.campaign,
        subCampaignId: metadata.subCampaignId,
        subCampaign: metadata.subCampaign,
        projectId: input.lead.projectId,
        phone: normalizedPhone,
        secondaryPhone: metadata.secondaryPhone,
        tertiaryPhone: metadata.tertiaryPhone,
        countryCode: metadata.countryCode,
        secondaryCountryCode: metadata.secondaryCountryCode,
        email: input.lead.email,
        secondaryEmail: metadata.secondaryEmail,
        medium: metadata.medium,
        description: metadata.description,
        channelPartner: metadata.channelPartner,
        details: serializeDetails(metadata.details),
        enquiryDate: metadata.enquiryDate,
        userId: input.userId,
      });

      let assignment: unknown = null;
      if (action === 'RE_ENGAGED') {
        const projectId = input.lead.projectId || existing.projectId;
        const projectName = input.lead.projectId
          ? (await tx.project.findFirst({ where: { id: input.lead.projectId, tenantId: input.tenantId }, select: { name: true } }))?.name || null
          : existing.project?.name || null;
        const rrQueue = await findApplicableRRQueue(input.tenantId, {
          projectId,
          projectName,
          status: 'NEW',
          source: metadata.source,
        }, tx);
        if (rrQueue && isLeadEligibleForAutoAssignment({
          status: 'NEW',
          source: metadata.source,
          lastSourceOfEnquiry: metadata.source,
          projectId,
          projectName,
          leadQueueing: true,
          leadAssigned: false,
        }, { isNewLead: true })) {
          assignment = await RoundRobinAssignmentService.assignLeadInTransaction(tx, rrQueue.id, existing.id, input.tenantId);
        }
        const assignedLead = await tx.lead.findUnique({ where: { id: existing.id }, select: { ownerId: true } });
        if (assignedLead?.ownerId !== existing.ownerId) {
          const newOwner = assignedLead?.ownerId
            ? await tx.user.findUnique({ where: { id: assignedLead.ownerId }, select: { profile: { select: { name: true } } } })
            : null;
          await createOwnerHistory({
            tenantId: input.tenantId,
            leadId: existing.id,
            previousOwnerId: existing.ownerId,
            newOwnerId: assignedLead?.ownerId || null,
            previousProfile: null,
            newProfile: newOwner?.profile?.name || null,
            previousStatus: existing.status,
            newStatus: 'NEW',
            handoffReason: 'Lead re-engaged and assigned',
            changedById: input.userId,
          }, tx);
        }
      }

      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId,
          leadId: existing.id,
          action: action === 'RE_ENGAGED' ? 'RE_ENGAGED' : 'ENQUIRY_RECEIVED',
          objectType: 'Lead',
          objectId: existing.id,
          oldValues: { status: existing.status, source: existing.source, ownerId: existing.ownerId },
          newValues: {
            status: action === 'RE_ENGAGED' ? 'NEW' : existing.status,
            leadAction: action,
            source: metadata.source,
            subSource: metadata.subSource || null,
            campaign: metadata.campaign || null,
            validationDays,
            daysDifference,
          },
        },
      });
      const lead = await tx.lead.findUnique({
        where: { id: existing.id },
        include: {
          owner: { select: { id: true, firstName: true, lastName: true } },
          project: { select: { id: true, name: true } },
        },
      });
      const siteVisit = await createSiteVisit(existing.id);
      return { action, lead, leadId: existing.id, enquiry, validationDays, daysDifference, assignment, siteVisit };
    }

    const leadNumber = await getNextLeadNumber(tx, input.tenantId);
    const newLead = await tx.lead.create({
      data: {
        tenantId: input.tenantId,
        creatorId: input.userId,
        leadNumber,
        firstName: input.lead.firstName || undefined,
        lastName: input.lead.lastName,
        salutation: input.lead.salutation || undefined,
        title: input.lead.title || undefined,
        email: input.lead.email || undefined,
        phone: normalizedPhone,
        mobile: input.lead.mobile ? normalizePhone(input.lead.mobile) : undefined,
        website: input.lead.website || undefined,
        company: input.lead.company,
        industry: input.lead.industry || undefined,
        annualRevenue: input.lead.annualRevenue || undefined,
        numberOfEmployees: input.lead.numberOfEmployees || undefined,
        source,
        lastSource: metadata.source,
        leadType: 'ORIGINAL',
        firstSubSource: metadata.subSource,
        lastSubSource: metadata.subSource,
        lastCampaign: metadata.campaign,
        status: 'NEW',
        rating: input.lead.rating || undefined,
        description: input.lead.description || undefined,
        street: input.lead.street || undefined,
        city: input.lead.city || undefined,
        stateProvince: input.lead.stateProvince || undefined,
        country: input.lead.country || undefined,
        postalCode: input.lead.postalCode || undefined,
        score: input.lead.score || 0,
        budget: input.lead.budget || undefined,
        ownerId: input.userId,
        projectId: input.lead.projectId || undefined,
        customFields: input.lead.customFields || {},
      },
      include: {
        owner: { select: { id: true, firstName: true, lastName: true } },
        project: { select: { id: true, name: true } },
      },
    });
    const enquiry = await createEnquiryInTransaction(tx, {
      tenantId: input.tenantId,
      leadId: newLead.id,
      leadType: 'ORIGINAL',
      enquiryType: 'ORIGINAL',
      source: metadata.source,
      subSource: metadata.subSource,
      campaignId: metadata.campaignId,
      campaign: metadata.campaign,
      subCampaignId: metadata.subCampaignId,
      subCampaign: metadata.subCampaign,
      projectId: input.lead.projectId,
      phone: normalizedPhone,
      secondaryPhone: metadata.secondaryPhone,
      tertiaryPhone: metadata.tertiaryPhone,
      countryCode: metadata.countryCode,
      secondaryCountryCode: metadata.secondaryCountryCode,
      email: input.lead.email,
      secondaryEmail: metadata.secondaryEmail,
      medium: metadata.medium,
      description: metadata.description,
      channelPartner: metadata.channelPartner,
      details: serializeDetails(metadata.details),
      enquiryDate: metadata.enquiryDate,
      userId: input.userId,
    });
    await createOwnerHistory({
      tenantId: input.tenantId,
      leadId: newLead.id,
      previousOwnerId: null,
      newOwnerId: input.userId,
      previousProfile: null,
      newProfile: input.profileName || null,
      previousStatus: null,
      newStatus: 'NEW',
      handoffReason: 'Lead Created',
      changedById: input.userId,
    }, tx);
    const rrQueue = await findApplicableRRQueue(input.tenantId, {
      projectId: input.lead.projectId || null,
      projectName: newLead.project?.name || null,
      status: 'NEW',
      source: metadata.source,
    }, tx);
    const assignment = rrQueue && isLeadEligibleForAutoAssignment({
      ...newLead,
      lastSourceOfEnquiry: metadata.source,
      leadQueueing: true,
      leadAssigned: false,
    }, { isNewLead: true })
      ? await RoundRobinAssignmentService.assignLeadInTransaction(tx, rrQueue.id, newLead.id, input.tenantId)
      : null;
    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        leadId: newLead.id,
        action: 'CREATE',
        objectType: 'Lead',
        objectId: newLead.id,
        newValues: {
          ...input.lead,
          source: metadata.source,
          enquiryType: 'ORIGINAL',
          assignedTo: newLead.owner ? `${newLead.owner.firstName} ${newLead.owner.lastName}` : null,
        },
      },
    });
    const lead = await tx.lead.findUnique({
      where: { id: newLead.id },
      include: {
        owner: { select: { id: true, firstName: true, lastName: true } },
        project: { select: { id: true, name: true } },
      },
    });
    const siteVisit = await createSiteVisit(newLead.id);
    return { action: 'NEW_LEAD' as const, lead, leadId: newLead.id, assignment, siteVisit, enquiry };
  });
}
