import { Router, Response } from 'express';
import { prisma } from '@dct-crm/db';
import { leadCreateSchema, leadUpdateSchema, normalizePhone, PHONE_DUPLICATE_ERROR, type JsonValue } from '@dct-crm/shared';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/authorization';
import { EffectivePermissionService } from '../services/effectivePermissions';
import { canTransitionStatus, isValidStatus } from '../services/workflow';
import { createOwnerHistory, getOwnerHistory } from '../services/ownerHistory';
import {
  canAccessLead,
  getLeadRecordScope,
  leadScopeClause,
} from '../services/recordAccess';
import { getNextSiteVisitNumber, normalizeOverdueSiteVisits } from '../services/leadWorkflowExtras';
import { validateFieldValue } from '../services/metadata';
import { changeLeadOwner, getEligibleLeadOwners } from '../services/leadOwnerChange';
import { processLeadEnquiry, sourceEnumValue } from '../services/enquiryProcessing';
import { getLeadEnquiries } from '../services/enquiryService';
import {
  findApplicableRRQueue,
  hasLeadAssignmentRelevantChanges,
  isLeadEligibleForAutoAssignment,
  RoundRobinAssignmentService,
} from '../services/rrQueue';
import { z } from 'zod';

const router = Router();

router.use(authenticate);

/**
 * Lead lookup tenant scope. Matches the existing GET / list rule: superadmin
 * sees and acts on every tenant's leads (recordAccess/authorization already
 * grant superadmin ALL-scope), while every other user stays tenant-scoped.
 */
function leadIdScope(req: AuthRequest): { tenantId?: string } {
  return req.user!.isSuperAdmin ? {} : { tenantId: req.tenantId! };
}

async function validateLeadCustomFields(
  tenantId: string,
  values: Record<string, unknown>,
  requireRequiredFields: boolean,
): Promise<string | null> {
  const leadObject = await prisma.objectDefinition.findFirst({
    where: { tenantId, name: 'Lead', isActive: true },
    select: { id: true },
  });
  if (!leadObject) {
    return Object.keys(values).length ? 'Lead field metadata is not configured' : null;
  }

  const definitions = await prisma.fieldDefinition.findMany({
    where: {
      tenantId,
      objectId: leadObject.id,
      isActive: true,
      isCustomField: true,
      isStandardField: false,
    },
    include: { picklistValues: { where: { isActive: true } } },
  });
  const definitionByName = new Map(definitions.map((field) => [field.name, field]));

  for (const name of Object.keys(values)) {
    if (!definitionByName.has(name)) return `Unknown Lead field: ${name}`;
  }

  for (const field of definitions) {
    const hasValue = Object.prototype.hasOwnProperty.call(values, field.name);
    if (!hasValue) {
      if (requireRequiredFields && field.required) return `${field.label} is required`;
      continue;
    }
    const value = values[field.name];
    const validation = validateFieldValue(field, value);
    if (!validation.valid) return validation.error || `Invalid value for ${field.label}`;
    if (
      field.fieldType === 'picklist' &&
      value !== null &&
      value !== undefined &&
      value !== '' &&
      !field.picklistValues.some((option) => option.value === value)
    ) {
      return `${field.label} has an invalid value`;
    }
    if (
      field.fieldType === 'multiPicklist' &&
      Array.isArray(value) &&
      !value.every((option) => field.picklistValues.some((item) => item.value === option))
    ) {
      return `${field.label} has an invalid value`;
    }
  }

  return null;
}

/**
 * Human-facing audit display: keys whose values are user IDs. The audit
 * history endpoints resolve them to display names so the UI never shows raw
 * internal user IDs. IDs are resolved in a single batched query (no N+1).
 */
const AUDIT_USER_KEYS = new Set([
  'ownerId',
  'previousOwnerId',
  'newOwnerId',
  'changedById',
  'createdById',
  'updatedById',
  'completedById',
  'cancelledById',
  'assignedById',
  'performedById',
  'userId',
  'changedBy',
  'createdBy',
  'updatedBy',
  'assignedBy',
  'performedBy',
]);

function auditDisplayValues(
  values: Record<string, unknown> | null | undefined,
  nameById: Map<string, string>,
): Record<string, unknown> | null | undefined {
  if (!values || typeof values !== 'object') return values;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (AUDIT_USER_KEYS.has(key)) {
      const siblingNameKey = key.endsWith('Id') ? `${key.slice(0, -2)}Name` : null;
      const hasSiblingName =
        !!siblingNameKey &&
        typeof (values as Record<string, unknown>)[siblingNameKey] === 'string' &&
        String((values as Record<string, unknown>)[siblingNameKey]).length > 0;
      if (hasSiblingName) {
        // Explicit *Name sibling present: keep the pair (the UI renders the
        // name row and skips the raw id — see getAuditChanges).
        out[key] = value;
        continue;
      }
      if (typeof value === 'string' && nameById.has(value)) {
        // No name sibling: resolve the id to a display name so nothing raw
        // is ever surfaced by consumers.
        out[key] = nameById.get(value);
        continue;
      }
      if (value === null && key.endsWith('ById')) {
        out[key] = 'System';
        continue;
      }
    }
    out[key] = value;
  }
  return out;
}

async function enrichAuditLogs<T extends { oldValues?: unknown; newValues?: unknown }>(logs: T[]) {
  const ids = new Set<string>();
  for (const log of logs) {
    for (const values of [log.oldValues, log.newValues]) {
      if (!values || typeof values !== 'object') continue;
      for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
        if (AUDIT_USER_KEYS.has(key) && typeof value === 'string' && value.startsWith('c')) {
          ids.add(value);
        }
      }
    }
  }
  const users = ids.size
    ? await prisma.user.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const nameById = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));

  return logs.map((log) => ({
    ...log,
    oldValues: auditDisplayValues(log.oldValues as Record<string, unknown> | null | undefined, nameById),
    newValues: auditDisplayValues(log.newValues as Record<string, unknown> | null | undefined, nameById),
  }));
}

const convertLeadSchema = z.object({
  projectId: z.string().optional(),
  unitId: z.string().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  amount: z.number().min(0).optional(),
  expectedCloseDate: z.string().datetime().optional(),
  probability: z.number().int().min(0).max(100).optional(),
  description: z.string().max(2000).optional(),
});

async function getNextOpportunityNumber(tx: any, tenantId: string): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`OPPORTUNITY_NUMBER:${tenantId}`}, 0))`;
  // Max-based (not count-based): counts drift below the highest number after any
  // opportunity deletion, which would re-issue an existing number and violate
  // the [tenantId, opportunityNumber] unique index.
  const rows = await tx.$queryRaw<{ maxn: bigint | null }[]>`
    SELECT max(CASE WHEN "opportunityNumber" ~ '^OPP[0-9]+$'
      THEN substring("opportunityNumber" from 4)::bigint END) AS maxn
    FROM "Opportunity"
    WHERE "tenantId" = ${tenantId}
  `;
  const maxn = rows?.[0]?.maxn != null ? Number(rows[0].maxn) : 0;
  return `OPP${String(maxn + 1).padStart(6, '0')}`;
}

async function findPhoneConflict(
  tenantId: string,
  phone: string,
  excludeLeadId?: string,
): Promise<boolean> {
  const normalized = normalizePhone(phone);
  const candidates = await prisma.lead.findMany({
    where: {
      tenantId,
      phone: { not: null },
      ...(excludeLeadId ? { id: { not: excludeLeadId } } : {}),
    },
    select: { id: true, phone: true },
  });
  return candidates.some(
    (lead) => lead.phone != null && normalizePhone(lead.phone) === normalized,
  );
}

function isPhoneUniqueViolation(error: any): boolean {
  if (error?.code !== 'P2002') return false;
  const target = error?.meta?.target;
  if (Array.isArray(target)) return target.includes('phone');
  if (typeof target === 'string') return target.includes('phone');
  return false;
}

type LeadDeletionStep =
  | { name: 'lead'; where: { id: string } }
  | {
      name: 'activity' | 'task' | 'followUp' | 'leadOwnerHistory' | 'payment' | 'siteVisit' | 'approval' | 'quotationItem' | 'booking' | 'quotation' | 'opportunity';
      where: Record<string, any>;
    };

export function buildLeadDeletionPlan(leadId: string): LeadDeletionStep[] {
  return [
    { name: 'activity', where: { OR: [{ leadId }, { siteVisit: { leadId } }, { opportunity: { leadId } }, { booking: { leadId } }] } },
    { name: 'task', where: { OR: [{ leadId }, { siteVisit: { leadId } }, { opportunity: { leadId } }] } },
    { name: 'followUp', where: { leadId } },
    { name: 'leadOwnerHistory', where: { leadId } },
    { name: 'payment', where: { booking: { leadId } } },
    { name: 'siteVisit', where: { leadId } },
    { name: 'approval', where: { quotation: { leadId } } },
    { name: 'quotationItem', where: { quotation: { leadId } } },
    { name: 'booking', where: { leadId } },
    { name: 'quotation', where: { leadId } },
    { name: 'opportunity', where: { leadId } },
    { name: 'lead', where: { id: leadId } },
  ];
}

const LEAD_DIFFABLE_FIELDS = [
  'firstName', 'lastName', 'salutation', 'title', 'email', 'phone', 'mobile',
  'website', 'company', 'industry', 'annualRevenue', 'numberOfEmployees',
  'source', 'status', 'rating', 'description', 'street', 'city',
  'stateProvince', 'country', 'postalCode', 'score', 'budget',
  'requirements', 'notes', 'ownerId', 'projectId',
  'customFields',
] as const;

function normalizeDiffValue(value: any): any {
  if (value === undefined) return null;
  if (value === '') return null;
  return value;
}

function areJsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => areJsonValuesEqual(value, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(rightRecord, key) &&
      areJsonValuesEqual(leftRecord[key], rightRecord[key]),
    );
}

function computeLeadDiff(
  existing: Record<string, any>,
  incoming: Record<string, any>,
): { oldValues: Record<string, any>; newValues: Record<string, any>; updateData: Record<string, any> } {
  const oldValues: Record<string, any> = {};
  const newValues: Record<string, any> = {};
  const updateData: Record<string, any> = {};

  for (const field of LEAD_DIFFABLE_FIELDS) {
    if (!(field in incoming)) continue;
    const incomingValue = normalizeDiffValue((incoming as Record<string, any>)[field]);
    const existingValue = normalizeDiffValue(existing[field]);
    if (
      field === 'customFields'
        ? areJsonValuesEqual(incomingValue, existingValue)
        : incomingValue === existingValue
    ) continue;
    oldValues[field] = existingValue;
    newValues[field] = incomingValue;
    updateData[field] = (incoming as Record<string, any>)[field] === '' ? null : (incoming as Record<string, any>)[field];
  }

  return { oldValues, newValues, updateData };
}

router.get('/', authorize('Lead', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const { page = 1, limit = 20, status, source, ownerId, search, sortBy = 'createdAt', sortOrder = 'desc', from, to } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {};
    if (!req.user!.isSuperAdmin) {
      where.tenantId = req.tenantId!;
    }
    const scope = await getLeadRecordScope(req.user!);
    const scopeClause = leadScopeClause(scope);
    if (scopeClause) {
      where.AND = Array.isArray(where.AND) ? [...where.AND, scopeClause] : [scopeClause];
    }
    if (status && status !== 'All Statuses') {
      if (!isValidStatus(String(status))) {
        return res.status(400).json({ success: false, error: 'Invalid status filter' });
      }
      where.status = String(status);
    }
    if (source) where.source = source;
    if (ownerId) where.ownerId = ownerId;
    if (from || to) {
      const createdAtFilter: any = {};
      if (from) {
        const start = new Date(`${from}T00:00:00.000Z`);
        if (!Number.isNaN(start.getTime())) createdAtFilter.gte = start;
      }
      if (to) {
        const end = new Date(`${to}T23:59:59.999Z`);
        if (!Number.isNaN(end.getTime())) createdAtFilter.lte = end;
      }
      if (Object.keys(createdAtFilter).length > 0) {
        where.createdAt = createdAtFilter;
      }
    }
    if (search) {
      const searchTerm = search as string;
      const words = searchTerm.trim().split(/\s+/).filter(Boolean);
      const matchWord = (word: string) => [
        { leadNumber: { contains: word, mode: 'insensitive' as const } },
        { firstName: { contains: word, mode: 'insensitive' as const } },
        { lastName: { contains: word, mode: 'insensitive' as const } },
        { email: { contains: word, mode: 'insensitive' as const } },
        { phone: { contains: word } },
        { company: { contains: word, mode: 'insensitive' as const } },
        { title: { contains: word, mode: 'insensitive' as const } },
      ];
      const searchClause =
        words.length > 1
          ? { AND: words.map((word) => ({ OR: matchWord(word) })) }
          : { OR: matchWord(searchTerm) };
      where.AND = Array.isArray(where.AND) ? [...where.AND, searchClause] : [searchClause];
    }

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        include: {
          owner: { select: { id: true, firstName: true, lastName: true } },
          project: { select: { id: true, name: true } },
          _count: { select: { siteVisits: true, opportunities: true, activities: true } },
        },
        skip,
        take: Number(limit),
        orderBy: { [sortBy as string]: sortOrder },
      }),
      prisma.lead.count({ where }),
    ]);

    res.json({
      success: true,
      data: leads,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get leads error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch leads' });
  }
});

router.get('/:id/enquiries', authorize('Enquiry', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, ...leadIdScope(req) },
      select: { id: true, tenantId: true, ownerId: true, creatorId: true },
    });
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    if (!(await canAccessLead(req.user!, lead))) {
      return res.status(403).json({ success: false, error: 'You do not have access to this lead' });
    }

    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit || '10'), 10) || 10));
    const result = await getLeadEnquiries(lead.tenantId, lead.id, page, limit);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Get Lead enquiries error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch Lead enquiries' });
  }
});

router.post('/:id/enquiries', authorize('Enquiry', 'create'), async (req: AuthRequest, res: Response) => {
  try {
    const payloadSchema = z.object({
      source: z.string().trim().min(1).max(120),
      subSource: z.string().trim().max(120).optional(),
      campaignId: z.string().trim().optional(),
      campaign: z.string().trim().max(160).optional(),
      subCampaignId: z.string().trim().optional(),
      subCampaign: z.string().trim().max(160).optional(),
      projectId: z.string().trim().optional(),
      phone: z.string().trim().max(64).optional(),
      secondaryPhone: z.string().trim().max(64).optional(),
      tertiaryPhone: z.string().trim().max(64).optional(),
      countryCode: z.string().trim().max(8).optional(),
      secondaryCountryCode: z.string().trim().max(8).optional(),
      email: z.string().trim().email().optional().or(z.literal('')),
      secondaryEmail: z.string().trim().email().optional().or(z.literal('')),
      medium: z.string().trim().max(120).optional(),
      description: z.string().trim().max(5000).optional(),
      channelPartner: z.string().trim().max(160).optional(),
      enquiryDate: z.coerce.date().optional(),
      details: z.record(z.string(), z.unknown()).optional(),
      siteVisit: z.object({
        projectId: z.string().trim().optional(),
        scheduledAt: z.coerce.date(),
        notes: z.string().trim().max(5000).optional(),
      }).optional(),
    });
    const payload = payloadSchema.parse(req.body);
    const existing = await prisma.lead.findFirst({
      where: { id: req.params.id, ...leadIdScope(req) },
    });
    if (!existing) return res.status(404).json({ success: false, error: 'Lead not found' });
    if (!(await canAccessLead(req.user!, existing))) {
      return res.status(403).json({ success: false, error: 'You do not have access to this lead' });
    }
    if (
      payload.siteVisit &&
      !req.user!.isSuperAdmin &&
      !(await EffectivePermissionService.hasPermission(req.user!.id, 'SITE_VISIT_CREATE'))
    ) {
      return res.status(403).json({ success: false, error: 'Insufficient permissions for SiteVisit:create' });
    }

    const leadData = leadCreateSchema.parse({
      firstName: existing.firstName || undefined,
      lastName: existing.lastName,
      company: existing.company,
      source: sourceEnumValue(payload.source),
      phone: payload.phone || existing.phone,
      email: payload.email || existing.email || undefined,
      projectId: payload.projectId || undefined,
      customFields: existing.customFields,
    });
    const result = await processLeadEnquiry({
      tenantId: existing.tenantId,
      userId: req.user!.id,
      profileName: req.user!.profileName,
      expectedLeadId: existing.id,
      lead: leadData,
      enquiry: {
        source: payload.source,
        subSource: payload.subSource,
        campaignId: payload.campaignId,
        campaign: payload.campaign,
        subCampaignId: payload.subCampaignId,
        subCampaign: payload.subCampaign,
        secondaryPhone: payload.secondaryPhone,
        tertiaryPhone: payload.tertiaryPhone,
        secondaryCountryCode: payload.secondaryCountryCode,
        countryCode: payload.countryCode,
        secondaryEmail: payload.secondaryEmail,
        medium: payload.medium,
        description: payload.description,
        channelPartner: payload.channelPartner,
        enquiryDate: payload.enquiryDate,
        details: payload.details,
      },
      siteVisit: payload.siteVisit
        ? {
            projectId: payload.siteVisit.projectId || payload.projectId,
            scheduledAt: payload.siteVisit.scheduledAt,
            notes: payload.siteVisit.notes,
          }
        : undefined,
    });
    if (result.action === 'DUPLICATE_CONFLICT') {
      return res.status(409).json({
        success: false,
        action: result.action,
        leadIds: result.leadIds,
        error: 'This phone number matches multiple existing Leads. Ask an administrator to resolve the duplicate records.',
      });
    }
    if (result.action === 'LEAD_MISMATCH') {
      return res.status(409).json({
        success: false,
        leadIds: result.leadIds,
        error: 'The enquiry phone number matches a different Lead. Create this enquiry from that Lead instead.',
      });
    }
    return res.status(201).json({ success: true, ...result });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.issues[0]?.message || 'Invalid enquiry data' });
    }
    if (error?.message === 'INVALID_PROJECT') {
      return res.status(400).json({ success: false, error: 'Invalid project' });
    }
    if (error?.message === 'PHONE_REQUIRED') {
      return res.status(400).json({ success: false, error: 'A phone number is required' });
    }
    console.error('Create Lead enquiry error:', error);
    return res.status(500).json({ success: false, error: 'Failed to create enquiry' });
  }
});

router.get('/:id', authorize('Lead', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    await normalizeOverdueSiteVisits(req.user!.tenantId);
    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, ...leadIdScope(req) },
      include: {
        owner: { select: { id: true, firstName: true, lastName: true, email: true } },
        creator: { select: { id: true, firstName: true, lastName: true } },
        project: { select: { id: true, name: true } },
        siteVisits: {
          include: {
            assignee: { select: { id: true, firstName: true, lastName: true } },
            project: { select: { id: true, name: true } },
          },
          orderBy: { scheduledAt: 'desc' },
        },
        opportunities: {
          include: { owner: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' },
        },
        activities: {
          include: { user: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        tasks: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        followUps: {
          orderBy: { dueDate: 'asc' },
          take: 10,
        },
        auditLogs: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
      },
    });

    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    if (!(await canAccessLead(req.user!, lead))) {
      return res.status(403).json({ success: false, error: 'You do not have access to this lead' });
    }

    const ownerHistory = await getOwnerHistory(lead.tenantId, req.params.id);

    const lastAudit = await prisma.auditLog.findFirst({
      where: {
        tenantId: lead.tenantId,
        OR: [{ leadId: lead.id }, { objectType: 'Lead', objectId: lead.id }],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    const lastModified = lastAudit
      ? {
          by: lastAudit.user,
          at: lastAudit.createdAt,
          action: lastAudit.action,
        }
      : {
          by: lead.creator
            ? { id: lead.creator.id, firstName: lead.creator.firstName, lastName: lead.creator.lastName, email: null }
            : null,
          at: lead.updatedAt,
          action: 'CREATE',
        };

    res.json({
      success: true,
      data: {
        ...lead,
        auditLogs: await enrichAuditLogs(lead.auditLogs),
        ownerHistory,
        lastModified,
      },
    });
  } catch (error) {
    console.error('Get lead error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch lead' });
  }
});

router.post('/:id/convert', authorize('Opportunity', 'create'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId: callerTenantId, id: userId } = req.user!;
    const data = convertLeadSchema.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`LEAD_CONVERSION:${callerTenantId}:${req.params.id}`}, 0))`;

      const lead = await tx.lead.findFirst({
        where: { id: req.params.id, ...leadIdScope(req) },
        include: {
          owner: { select: { id: true, firstName: true, lastName: true } },
          siteVisits: {
            where: { status: 'COMPLETED' },
            orderBy: [{ completedAt: 'desc' }, { updatedAt: 'desc' }],
            take: 1,
          },
          opportunities: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });
      if (!lead) throw new Error('LEAD_NOT_FOUND');
      const tenantId = lead.tenantId;
      if (!(await canAccessLead(req.user!, lead))) throw new Error('LEAD_ACCESS_DENIED');
      if (lead.status !== 'SITE_VISIT_HAPPENED') throw new Error('LEAD_NOT_READY');
      // Conversion performs an automatic SITE_VISIT_HAPPENED -> BOOKED transition:
      // enforce the same workflow rules as PUT /:id/status (with the same admin bypass)
      const profileName = req.user!.profileName || 'Admin';
      if (profileName !== 'Admin' && profileName !== 'Manager' && profileName !== 'CRM Admin') {
        if (!canTransitionStatus(profileName, 'SITE_VISIT_HAPPENED', 'BOOKED')) {
          throw new Error(
            `CONVERSION_STATUS_FORBIDDEN|Profile ${profileName} cannot change status from SITE_VISIT_HAPPENED to BOOKED`,
          );
        }
      }
      if (lead.opportunities.length > 0) {
        return { opportunity: lead.opportunities[0], lead, duplicate: true };
      }
      const completedSiteVisit = lead.siteVisits[0];
      if (!completedSiteVisit) throw new Error('COMPLETED_SITE_VISIT_REQUIRED');

      if (data.projectId && completedSiteVisit.projectId && data.projectId !== completedSiteVisit.projectId) {
        throw new Error('PROJECT_MISMATCH');
      }
      const projectId = completedSiteVisit.projectId || data.projectId || lead.projectId || undefined;
      if (!projectId) throw new Error('PROJECT_REQUIRED');
      const project = await tx.project.findFirst({ where: { id: projectId, tenantId, isActive: true }, select: { id: true } });
      if (!project) throw new Error('INVALID_PROJECT');

      if (data.unitId) {
        const unit = await tx.unit.findFirst({
          where: { id: data.unitId, tenantId, projectId, status: 'AVAILABLE' },
          select: { id: true },
        });
        if (!unit) throw new Error('INVALID_UNIT');
      }

      const opportunityOwnerId = lead.ownerId || userId;

      // Step 13: Generate Opportunity Number
      const opportunityNumber = await getNextOpportunityNumber(tx, tenantId);
      const opportunity = await tx.opportunity.create({
        data: {
          tenantId,
          opportunityNumber,
          name: data.name || `${lead.company} Opportunity`,
          leadId: lead.id,
          ownerId: opportunityOwnerId,
          creatorId: userId,
          projectId,
          unitId: data.unitId,
          siteVisitId: completedSiteVisit.id,
          stage: 'PROSPECTING',
          amount: data.amount,
          expectedCloseDate: data.expectedCloseDate ? new Date(data.expectedCloseDate) : undefined,
          probability: data.probability,
          description: data.description || lead.requirements || lead.notes,
        },
        include: {
          lead: { select: { id: true, leadNumber: true, firstName: true, lastName: true } },
          owner: { select: { id: true, firstName: true, lastName: true, profile: { select: { name: true } } } },
          project: { select: { id: true, name: true } },
          unit: { select: { id: true, number: true, type: true, area: true, price: true, status: true } },
          siteVisit: { select: { id: true, siteVisitNumber: true, completedAt: true } },
        },
      });

      // Step 16: Update Lead status to BOOKED — only after Opportunity creation succeeded
      const convertedLead = await tx.lead.update({
        where: { id: lead.id },
        data: { status: 'BOOKED', lostAt: null },
      });

      // Step 17: Conversion audit log
      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          leadId: lead.id,
          opportunityId: opportunity.id,
          action: 'LEAD_CONVERTED_TO_OPPORTUNITY',
          objectType: 'Lead',
          objectId: lead.id,
          oldValues: { status: 'SITE_VISIT_HAPPENED' },
          newValues: {
            status: 'BOOKED',
            leadNumber: lead.leadNumber,
            opportunityId: opportunity.id,
            opportunityNumber,
            ownerId: opportunityOwnerId,
            siteVisitId: completedSiteVisit.id,
            projectId,
            unitId: data.unitId || null,
          },
        },
      });

      return { opportunity, lead: convertedLead, duplicate: false };
    });
    return res.status(result.duplicate ? 200 : 201).json({ success: true, data: result });
  } catch (error: any) {
    if (error.name === 'ZodError') return res.status(400).json({ success: false, error: error.errors[0].message });
    if (typeof error.message === 'string' && error.message.startsWith('CONVERSION_STATUS_FORBIDDEN|')) {
      return res.status(403).json({ success: false, error: error.message.slice(error.message.indexOf('|') + 1) });
    }
    const errors: Record<string, [number, string]> = {
      LEAD_NOT_FOUND: [404, 'Lead not found'],
      LEAD_ACCESS_DENIED: [403, 'You do not have access to this lead'],
      LEAD_NOT_READY: [400, 'Lead must be Site Visit Happened before conversion'],
      COMPLETED_SITE_VISIT_REQUIRED: [400, 'A completed Site Visit is required'],
      PROJECT_REQUIRED: [400, 'Project is required'],
      INVALID_PROJECT: [400, 'Invalid project'],
      PROJECT_MISMATCH: [400, 'Opportunity project must match the completed Site Visit project'],
      INVALID_UNIT: [400, 'Unit is unavailable or does not belong to the project'],
    };
    const mapped = errors[error.message];
    if (mapped) return res.status(mapped[0]).json({ success: false, error: mapped[1] });
    console.error('Convert lead error:', error);
    return res.status(500).json({ success: false, error: 'Failed to convert lead' });
  }
});

router.post('/', authorize('Lead', 'create'), async (req: AuthRequest, res: Response) => {
  try {
    const {
      subSource,
      campaignId,
      campaign,
      subCampaignId,
      subCampaign,
      secondaryPhone,
      tertiaryPhone,
      secondaryEmail,
      countryCode,
      secondaryCountryCode,
      medium,
      enquiryDescription,
      channelPartner,
      enquiryDate,
      enquiryDetails,
      siteVisit,
      ...leadInput
    } = req.body || {};
    const metadata = z.object({
      subSource: z.string().trim().max(120).optional(),
      campaignId: z.string().trim().optional(),
      campaign: z.string().trim().max(160).optional(),
      subCampaignId: z.string().trim().optional(),
      subCampaign: z.string().trim().max(160).optional(),
      secondaryPhone: z.string().trim().max(64).optional(),
      tertiaryPhone: z.string().trim().max(64).optional(),
      secondaryEmail: z.string().trim().email().optional(),
      countryCode: z.string().trim().max(8).optional(),
      secondaryCountryCode: z.string().trim().max(8).optional(),
      medium: z.string().trim().max(120).optional(),
      enquiryDescription: z.string().trim().max(5000).optional(),
      channelPartner: z.string().trim().max(160).optional(),
      enquiryDate: z.coerce.date().optional(),
      enquiryDetails: z.record(z.string(), z.unknown()).optional(),
      siteVisit: z.object({
        projectId: z.string().optional(),
        scheduledAt: z.coerce.date(),
        notes: z.string().trim().max(5000).optional(),
      }).optional(),
    }).parse({
      subSource, campaignId, campaign, subCampaignId, subCampaign,
      secondaryPhone, tertiaryPhone, secondaryEmail, countryCode,
      secondaryCountryCode, medium, enquiryDescription, channelPartner,
      enquiryDate, enquiryDetails, siteVisit,
    });
    const incomingSource = typeof leadInput.source === 'string' ? leadInput.source : 'OTHER';
    const data = leadCreateSchema.parse({
      ...leadInput,
      source: sourceEnumValue(incomingSource),
    });
    const customFieldError = await validateLeadCustomFields(
      req.tenantId!,
      data.customFields || {},
      true,
    );
    if (customFieldError) {
      return res.status(400).json({ success: false, error: customFieldError });
    }
    if (
      metadata.siteVisit &&
      !req.user!.isSuperAdmin &&
      !(await EffectivePermissionService.hasPermission(req.user!.id, 'SITE_VISIT_CREATE'))
    ) {
      return res.status(403).json({ success: false, error: 'Insufficient permissions for SiteVisit:create' });
    }

    const result = await processLeadEnquiry({
      tenantId: req.tenantId!,
      userId: req.user!.id,
      profileName: req.user!.profileName,
      lead: data,
      enquiry: {
        source: incomingSource,
        subSource: metadata.subSource,
        campaignId: metadata.campaignId,
        campaign: metadata.campaign,
        subCampaignId: metadata.subCampaignId,
        subCampaign: metadata.subCampaign,
        secondaryPhone: metadata.secondaryPhone,
        tertiaryPhone: metadata.tertiaryPhone,
        secondaryEmail: metadata.secondaryEmail,
        countryCode: metadata.countryCode,
        secondaryCountryCode: metadata.secondaryCountryCode,
        medium: metadata.medium,
        description: metadata.enquiryDescription,
        channelPartner: metadata.channelPartner,
        enquiryDate: metadata.enquiryDate,
        details: metadata.enquiryDetails,
      },
      siteVisit: metadata.siteVisit
        ? {
            projectId: metadata.siteVisit.projectId || data.projectId || undefined,
            scheduledAt: metadata.siteVisit.scheduledAt,
            notes: metadata.siteVisit.notes,
          }
        : undefined,
    });
    if (result.action === 'DUPLICATE_CONFLICT') {
      return res.status(409).json({
        success: false,
        action: result.action,
        leadIds: result.leadIds,
        error: 'This phone number matches multiple existing Leads. Ask an administrator to resolve the duplicate records.',
      });
    }
    res.status(result.action === 'NEW_LEAD' ? 201 : 200).json({
      success: true,
      action: result.action,
      leadId: result.leadId,
      data: result.lead,
      validationDays: result.validationDays,
      daysDifference: result.daysDifference,
      assignment: result.assignment,
      enquiry: result.enquiry,
      siteVisit: result.siteVisit,
      message: result.action === 'NEW_LEAD'
        ? 'New lead created and assigned'
        : result.action === 'RE_ENGAGED'
          ? 'Existing lost lead re-engaged successfully'
          : result.action === 'OUTSIDE_REENGAGEMENT_WINDOW'
            ? 'Existing lost lead is outside the re-engagement validation period'
            : 'Lead already exists',
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: error.errors[0].message });
    }
    if (isPhoneUniqueViolation(error)) {
      return res.status(409).json({ success: false, action: 'DUPLICATE_CONFLICT', error: PHONE_DUPLICATE_ERROR });
    }
    if (error?.message === 'INVALID_PROJECT') {
      return res.status(400).json({ success: false, error: 'Invalid project' });
    }
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.issues[0]?.message || 'Invalid enquiry data' });
    }
    console.error('Create lead error:', error);
    res.status(500).json({ success: false, error: 'Failed to create lead' });
  }
});

router.put('/:id', authorize('Lead', 'edit'), async (req: AuthRequest, res: Response) => {
  try {
    const existingLead = await prisma.lead.findFirst({
      where: { id: req.params.id, ...leadIdScope(req) },
    });

    if (!existingLead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    if (!(await canAccessLead(req.user!, existingLead))) {
      return res.status(403).json({ success: false, error: 'You do not have access to this lead' });
    }

    const bodyData = { ...req.body };
    delete bodyData.leadNumber;
    const reason =
      typeof bodyData.reason === 'string' && bodyData.reason.trim()
        ? bodyData.reason.trim()
        : undefined;
    delete bodyData.reason;
    const data = leadUpdateSchema.parse(bodyData);

    if (data.customFields) {
      const customFieldError = await validateLeadCustomFields(
        existingLead.tenantId,
        data.customFields,
        false,
      );
      if (customFieldError) {
        return res.status(400).json({ success: false, error: customFieldError });
      }
      const storedCustomFields = existingLead.customFields;
      data.customFields = {
        ...(storedCustomFields && typeof storedCustomFields === 'object' && !Array.isArray(storedCustomFields)
          ? storedCustomFields as Record<string, JsonValue>
          : {}),
        ...data.customFields,
      };
    }

    if (data.status && !isValidStatus(data.status)) {
      return res.status(400).json({ success: false, error: `Invalid status: ${data.status}` });
    }

    if (data.phone !== undefined && data.phone !== '') {
      const phoneToCheck = normalizePhone(data.phone);
      if (await findPhoneConflict(existingLead.tenantId, phoneToCheck, req.params.id)) {
        return res.status(409).json({ success: false, error: PHONE_DUPLICATE_ERROR });
      }
      data.phone = phoneToCheck;
    }

    if (data.status) {
      const profileName = req.user!.profileName || 'Admin';

      if (profileName !== 'Admin' && profileName !== 'Manager' && profileName !== 'CRM Admin') {
        if (!canTransitionStatus(profileName, existingLead.status, data.status)) {
          return res.status(403).json({
            success: false,
            error: `Profile ${profileName} cannot change status from ${existingLead.status} to ${data.status}`,
          });
        }
      }
    }

    const { oldValues, newValues, updateData } = computeLeadDiff(existingLead, data);
    if (updateData.status) {
      updateData.lostAt = updateData.status === 'LOST' ? new Date() : null;
    }

    if (Object.keys(updateData).length === 0) {
      const unchanged = await prisma.lead.findFirst({
        where: { id: req.params.id, ...leadIdScope(req) },
        include: {
          owner: { select: { id: true, firstName: true, lastName: true } },
          project: { select: { id: true, name: true } },
        },
      });
      return res.json({ success: true, data: unchanged, unchanged: true });
    }

    const ownerChanged =
      'ownerId' in updateData &&
      normalizeDiffValue(updateData.ownerId) !== normalizeDiffValue(existingLead.ownerId);
    const shouldReassign = hasLeadAssignmentRelevantChanges(updateData);

    const result = await prisma.$transaction(async (tx) => {
      const lead = await tx.lead.update({
        where: { id: req.params.id },
        data: updateData,
        include: {
          owner: { select: { id: true, firstName: true, lastName: true } },
          project: { select: { id: true, name: true } },
        },
      });

      const auditNewValues = reason ? { ...newValues, reason } : newValues;

      await tx.auditLog.create({
        data: {
          tenantId: existingLead.tenantId,
          userId: req.user!.id,
          leadId: lead.id,
          action: ownerChanged && Object.keys(newValues).length === 1 ? 'OWNER_CHANGED' : 'UPDATE',
          objectType: 'Lead',
          objectId: lead.id,
          oldValues,
          newValues: auditNewValues,
        },
      });

      if (ownerChanged) {
        const newOwnerId = normalizeDiffValue(updateData.ownerId);
        const newOwner = newOwnerId
          ? await tx.user.findUnique({
              where: { id: newOwnerId },
              select: { id: true, firstName: true, lastName: true, profile: { select: { name: true } } },
            })
          : null;

        await createOwnerHistory(
          {
            tenantId: existingLead.tenantId,
            leadId: lead.id,
            previousOwnerId: existingLead.ownerId,
            newOwnerId: newOwnerId as string | null,
            previousProfile: null,
            newProfile: newOwner?.profile?.name || null,
            previousStatus: existingLead.status,
            newStatus: lead.status,
            handoffReason: reason || 'Owner changed via lead update',
            changedById: req.user!.id,
          },
          tx,
        );
      }

      const leadForAssignment = {
        ...lead,
        projectId: Object.prototype.hasOwnProperty.call(updateData, 'projectId')
          ? updateData.projectId
          : lead.projectId || existingLead.projectId || null,
        projectName: lead.project?.name || (Object.prototype.hasOwnProperty.call(updateData, 'projectId') ? null : existingLead.projectId) || null,
        status: updateData.status ?? lead.status,
        source: updateData.source ?? lead.source,
        leadQueueing: shouldReassign,
        leadAssigned: !shouldReassign,
        leadReassign: shouldReassign,
      };

      let assignment: any = null;
      if (shouldReassign && isLeadEligibleForAutoAssignment(leadForAssignment, { isNewLead: false })) {
        const queue = await findApplicableRRQueue(existingLead.tenantId, {
          projectId: leadForAssignment.projectId,
          projectName: leadForAssignment.projectName,
          status: String(leadForAssignment.status),
          source: String(leadForAssignment.source),
          priority: String(leadForAssignment.rating || ''),
        }, tx);
        if (queue) {
          assignment = await RoundRobinAssignmentService.assignLeadInTransaction(tx, queue.id, lead.id, existingLead.tenantId);
        }
      }

      return { ...lead, assignment };
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: error.errors[0].message });
    }
    if (isPhoneUniqueViolation(error)) {
      return res.status(409).json({ success: false, error: PHONE_DUPLICATE_ERROR });
    }
    if (error?.message === 'NO_ELIGIBLE_USER') {
      return res.status(409).json({
        success: false,
        error: 'No eligible RR queue member or fallback owner is available for this lead.',
      });
    }
    console.error('Update lead error:', error);
    res.status(500).json({ success: false, error: 'Failed to update lead' });
  }
});

router.delete('/:id', authorize('Lead', 'delete'), async (req: AuthRequest, res: Response) => {
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, ...leadIdScope(req) },
    });

    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    if (!(await canAccessLead(req.user!, lead))) {
      return res.status(403).json({ success: false, error: 'You do not have access to this lead' });
    }

    await prisma.auditLog.create({
      data: {
        tenantId: lead.tenantId,
        userId: req.user!.id,
        action: 'DELETE',
        objectType: 'Lead',
        objectId: lead.id,
        oldValues: lead,
      },
    });

    await prisma.$transaction(async (tx) => {
      const cleanupPlan = buildLeadDeletionPlan(lead.id);

      for (const step of cleanupPlan) {
        if (step.name === 'lead') {
          await tx.lead.delete({ where: step.where });
          continue;
        }

        if (step.name === 'activity') {
          await tx.activity.deleteMany({ where: step.where as any });
          continue;
        }

        if (step.name === 'task') {
          await tx.task.deleteMany({ where: step.where as any });
          continue;
        }

        if (step.name === 'followUp') {
          await tx.followUp.deleteMany({ where: step.where as any });
          continue;
        }

        if (step.name === 'leadOwnerHistory') {
          await tx.leadOwnerHistory.deleteMany({ where: step.where as any });
          continue;
        }

        if (step.name === 'payment') {
          await tx.payment.deleteMany({ where: step.where as any });
          continue;
        }

        if (step.name === 'siteVisit') {
          await tx.siteVisit.deleteMany({ where: step.where as any });
          continue;
        }

        if (step.name === 'approval') {
          await tx.approval.deleteMany({ where: step.where as any });
          continue;
        }

        if (step.name === 'quotationItem') {
          await tx.quotationItem.deleteMany({ where: step.where as any });
          continue;
        }

        if (step.name === 'booking') {
          await tx.booking.deleteMany({ where: step.where as any });
          continue;
        }

        if (step.name === 'quotation') {
          await tx.quotation.deleteMany({ where: step.where as any });
          continue;
        }

        if (step.name === 'opportunity') {
          await tx.opportunity.deleteMany({ where: step.where as any });
        }
      }
    });

    res.json({ success: true, message: 'Lead deleted successfully' });
  } catch (error) {
    console.error('Delete lead error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete lead' });
  }
});

router.post('/:id/push-to-svc', authorize('Lead', 'edit'), async (req: AuthRequest, res: Response) => {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, error: 'Reason/note is required for status change' });
    }

    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, ...leadIdScope(req) },
      include: { owner: { select: { id: true, firstName: true, lastName: true } } },
    });

    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    if (!(await canAccessLead(req.user!, lead))) {
      return res.status(403).json({ success: false, error: 'You do not have access to this lead' });
    }

    if (lead.status !== 'INCOMING') {
      return res.status(400).json({ success: false, error: 'Lead must be in Incoming status to push to SVC' });
    }

    const profileName = req.user!.profileName || 'Admin';

    if (profileName !== 'Admin' && profileName !== 'Manager' && profileName !== 'CRM Admin') {
      if (!canTransitionStatus(profileName, 'INCOMING', 'PROSPECT')) {
        return res.status(403).json({ success: false, error: 'Not authorized to push leads to SVC' });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedLead = await tx.lead.update({
        where: { id: req.params.id },
        data: { status: 'PROSPECT', lostAt: null },
        include: {
          owner: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: lead.tenantId,
          userId: req.user!.id,
          leadId: lead.id,
          action: 'PUSH_TO_SVC',
          objectType: 'Lead',
          objectId: lead.id,
          oldValues: { status: 'INCOMING', ownerId: lead.ownerId },
          newValues: {
            status: 'PROSPECT',
            note: reason,
            reason,
          },
        },
      });

      return updatedLead;
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Push to SVC error:', error);
    res.status(500).json({ success: false, error: 'Failed to push lead to SVC' });
  }
});

router.post('/:id/move-to-recovery', authorize('Lead', 'edit'), async (req: AuthRequest, res: Response) => {
  try {
    const { recoveryReason, note } = req.body;
    if (!recoveryReason || !recoveryReason.trim()) {
      return res.status(400).json({ success: false, error: 'Recovery reason is required' });
    }

    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, ...leadIdScope(req) },
      include: { owner: { select: { id: true, firstName: true, lastName: true } } },
    });

    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    if (!(await canAccessLead(req.user!, lead))) {
      return res.status(403).json({ success: false, error: 'You do not have access to this lead' });
    }

    if (lead.status !== 'INCOMING' && lead.status !== 'NEW') {
      return res.status(400).json({ success: false, error: 'Lead must be in New or Incoming status to move to recovery' });
    }

    const profileName = req.user!.profileName || 'Admin';

    if (profileName !== 'Admin' && profileName !== 'Manager' && profileName !== 'CRM Admin') {
      if (!canTransitionStatus(profileName, lead.status, 'LOST')) {
        return res.status(403).json({ success: false, error: 'Not authorized to move this lead to recovery' });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedLead = await tx.lead.update({
        where: { id: req.params.id },
        data: { status: 'LOST', lostAt: new Date() },
        include: { owner: { select: { id: true, firstName: true, lastName: true } } },
      });

      await createOwnerHistory(
        {
          tenantId: lead.tenantId,
          leadId: lead.id,
          previousOwnerId: lead.ownerId,
          newOwnerId: null,
          previousProfile: profileName,
          newProfile: 'Recovery',
          previousStatus: lead.status,
          newStatus: 'LOST',
          handoffReason: recoveryReason,
          changedById: req.user!.id,
        },
        tx,
      );

      await tx.auditLog.create({
        data: {
          tenantId: lead.tenantId,
          userId: req.user!.id,
          leadId: lead.id,
          action: 'MOVE_TO_RECOVERY',
          objectType: 'Lead',
          objectId: lead.id,
          oldValues: { status: lead.status, ownerId: lead.ownerId },
          newValues: { status: 'LOST', recoveryReason, recoveryNote: note, reason: recoveryReason },
        },
      });

      return updatedLead;
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Move to recovery error:', error);
    res.status(500).json({ success: false, error: 'Failed to move lead to recovery' });
  }
});

router.post('/:id/schedule-site-visit', authorize('Lead', 'edit'), async (req: AuthRequest, res: Response) => {
  try {
    const request = z.object({
      projectId: z.string().trim().min(1, 'Project is required for site visit'),
      notes: z.string().trim().min(1, 'Note/reason is required for site visit').max(2000),
      scheduledAt: z.string().datetime('Visit date/time is required'),
    }).safeParse(req.body);
    if (!request.success) {
      return res.status(400).json({ success: false, error: request.error.issues[0].message });
    }
    const { scheduledAt, notes, projectId } = request.data;

    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, ...leadIdScope(req) },
      include: { owner: { select: { id: true, firstName: true, lastName: true } } },
    });

    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    if (!(await canAccessLead(req.user!, lead))) {
      return res.status(403).json({ success: false, error: 'You do not have access to this lead' });
    }

    if (lead.status !== 'PROSPECT') {
      return res.status(400).json({ success: false, error: 'Lead must be in Prospect status to schedule site visit' });
    }

    const profileName = req.user!.profileName || 'Admin';

    if (profileName !== 'Admin' && profileName !== 'Manager' && profileName !== 'CRM Admin') {
      if (!canTransitionStatus(profileName, 'PROSPECT', 'SITE_VISIT_SCHEDULED')) {
        return res.status(403).json({ success: false, error: 'Not authorized to schedule site visits' });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const project = await tx.project.findFirst({
        where: { id: projectId, tenantId: lead.tenantId, isActive: true },
        select: { id: true },
      });
      if (!project) {
        throw new Error('PROJECT_NOT_AVAILABLE');
      }

      const siteVisitNumber = await getNextSiteVisitNumber(tx, lead.tenantId);
      const siteVisit = await tx.siteVisit.create({
        data: {
          tenantId: lead.tenantId,
          leadId: lead.id,
          projectId,
          assigneeId: lead.ownerId || req.user!.id,
          creatorId: req.user!.id,
          siteVisitNumber,
          scheduledAt: new Date(scheduledAt),
          status: 'SCHEDULED',
          notes,
        },
        include: {
          assignee: { select: { id: true, firstName: true, lastName: true } },
          project: { select: { id: true, name: true } },
        },
      });

      const updatedLead = await tx.lead.update({
        where: { id: req.params.id },
        data: { status: 'SITE_VISIT_SCHEDULED', lostAt: null },
        include: {
          owner: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: lead.tenantId,
          userId: req.user!.id,
          leadId: lead.id,
          action: 'SITE_VISIT_SCHEDULED',
          objectType: 'Lead',
          objectId: lead.id,
          oldValues: { status: 'PROSPECT', ownerId: lead.ownerId },
          newValues: {
            status: 'SITE_VISIT_SCHEDULED',
            siteVisitId: siteVisit.id,
            note: notes,
            reason: notes,
          },
        },
      });

      return { lead: updatedLead, siteVisit };
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    if (error?.message === 'PROJECT_NOT_AVAILABLE') {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }
    console.error('Schedule site visit error:', error);
    res.status(500).json({ success: false, error: 'Failed to schedule site visit' });
  }
});

router.put('/:id/status', authorize('Lead', 'edit'), async (req: AuthRequest, res: Response) => {
  try {
    const { status, note } = req.body;

    if (!isValidStatus(status)) {
      return res.status(400).json({ success: false, error: `Invalid status: ${status}` });
    }

    if (!note || !note.trim()) {
      return res.status(400).json({ success: false, error: 'A note/reason is required for status change' });
    }

    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, ...leadIdScope(req) },
    });

    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    if (!(await canAccessLead(req.user!, lead))) {
      return res.status(403).json({ success: false, error: 'You do not have access to this lead' });
    }

    if (lead.status === status) {
      return res.status(400).json({ success: false, error: `Lead is already in ${status} status` });
    }

    const profileName = req.user!.profileName || 'Admin';

    if (profileName !== 'Admin' && profileName !== 'Manager' && profileName !== 'CRM Admin') {
      if (!canTransitionStatus(profileName, lead.status, status)) {
        return res.status(403).json({
          success: false,
          error: `Profile ${profileName} cannot change status from ${lead.status} to ${status}`,
        });
      }
    }

    const updatedLead = await prisma.lead.update({
      where: { id: req.params.id },
      data: { status, lostAt: status === 'LOST' ? new Date() : null },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: lead.tenantId,
        userId: req.user!.id,
        leadId: lead.id,
        action: 'STATUS_CHANGE',
        objectType: 'Lead',
        objectId: lead.id,
        oldValues: { status: lead.status },
        newValues: { status, note, reason: note },
      },
    });

    res.json({ success: true, data: updatedLead });
  } catch (error) {
    console.error('Update lead status error:', error);
    res.status(500).json({ success: false, error: 'Failed to update lead status' });
  }
});

router.patch('/:id/owner', authorize('Lead', 'assign'), async (req: AuthRequest, res: Response) => {
  try {
    const { ownerId, reason } = req.body || {};
    const data = await changeLeadOwner({
      leadId: req.params.id,
      newOwnerId: typeof ownerId === 'string' ? ownerId : '',
      reason: typeof reason === 'string' ? reason : '',
      changedBy: req.user!,
    });
    res.json({ success: true, data });
  } catch (error: any) {
    const message = error?.message || 'Failed to change lead owner';
    const status = message === 'Lead not found' ? 404
      : message.includes('access') || message.includes('permission') ? 403
      : message.includes('required') || message.includes('different') || message.includes('eligible') ? 400
      : 500;
    if (status === 500) console.error('Change lead owner error:', error);
    res.status(status).json({ success: false, error: message });
  }
});

router.put('/:id/assign', authorize('Lead', 'assign'), async (req: AuthRequest, res: Response) => {
  try {
    const data = await changeLeadOwner({
      leadId: req.params.id,
      newOwnerId: typeof req.body?.ownerId === 'string' ? req.body.ownerId : '',
      reason: typeof req.body?.reason === 'string' ? req.body.reason : '',
      changedBy: req.user!,
    });
    res.json({ success: true, data });
  } catch (error: any) {
    const message = error?.message || 'Failed to change lead owner';
    const status = message === 'Lead not found' ? 404
      : message.includes('access') ? 403
      : message.includes('required') || message.includes('different') || message.includes('eligible') ? 400
      : 500;
    if (status === 500) console.error('Assign lead error:', error);
    res.status(status).json({ success: false, error: message });
  }
});

router.get('/:id/owner-candidates', authorize('Lead', 'assign'), async (req: AuthRequest, res: Response) => {
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, ...leadIdScope(req) },
      select: { id: true, tenantId: true, ownerId: true, creatorId: true },
    });
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    if (!(await canAccessLead(req.user!, lead))) {
      return res.status(403).json({ success: false, error: 'You do not have access to this lead' });
    }
    const candidates = await getEligibleLeadOwners(lead.tenantId, lead.ownerId);
    res.json({ success: true, data: candidates });
  } catch (error) {
    console.error('Get lead owner candidates error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch eligible owners' });
  }
});

router.get('/:id/owner-history', authorize('Lead', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, ...leadIdScope(req) },
    });

    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    if (!(await canAccessLead(req.user!, lead))) {
      return res.status(403).json({ success: false, error: 'You do not have access to this lead' });
    }

    const history = await getOwnerHistory(lead.tenantId, req.params.id);
    res.json({ success: true, data: history });
  } catch (error) {
    console.error('Get owner history error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch owner history' });
  }
});

router.get('/:id/audit-history', authorize('Lead', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const { page = 1, limit = 20, action } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, ...leadIdScope(req) },
      select: { id: true, tenantId: true, ownerId: true, creatorId: true },
    });

    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    if (!(await canAccessLead(req.user!, lead))) {
      return res.status(403).json({ success: false, error: 'You do not have access to this lead' });
    }

    const where: any = {
      tenantId: lead.tenantId,
      OR: [{ leadId: lead.id }, { objectType: 'Lead', objectId: lead.id }],
    };
    if (action) where.action = action;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({
      success: true,
      data: await enrichAuditLogs(logs),
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get lead audit history error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch lead audit history' });
  }
});

export { router as leadRoutes };