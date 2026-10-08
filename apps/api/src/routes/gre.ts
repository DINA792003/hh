import { randomBytes, createHash } from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '@dct-crm/db';
import { GreSessionStatus, Industry, LeadStatus, Prisma, SiteVisitStatus } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getNextSiteVisitNumber } from '../services/leadWorkflowExtras';
import { createOwnerHistory } from '../services/ownerHistory';
import { findApplicableRRQueue, getReusableSiteVisitOwner, isNewProjectSiteVisit, isSiteVisitRevisit, RoundRobinAssignmentService } from '../services/rrQueue';

const router = Router();
const publicRouter = Router();

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
});

router.use('/public', publicRouter);

export const phoneCheckSchema = z.object({
  countryCode: z.string().regex(/^\+\d{1,3}$/),
  phone: z.string().trim().min(6).max(30).regex(/^[0-9+().\s-]+$/),
  alternatePhone: z.string().trim().max(30).regex(/^[0-9+().\s-]+$/).optional().or(z.literal('')),
});

const optionalText = (max = 500) => z.string().trim().max(max).optional().or(z.literal(''));
export const greDraftSchema = z.object({
  lead: z.object({
    firstName: optionalText(100),
    lastName: optionalText(100),
    secondaryPhone: optionalText(30),
    tertiaryPhone: optionalText(30),
    email: z.string().trim().email().max(254).optional().or(z.literal('')),
    alternateEmail: z.string().trim().email().max(254).optional().or(z.literal('')),
    leadSubSource: optionalText(100),
    campaign: optionalText(150),
    projectId: optionalText(100),
    leadType: optionalText(100),
    preferredLocation: optionalText(150),
    budget: z.coerce.number().finite().min(0).max(1_000_000_000_000).optional().nullable(),
    occupation: optionalText(150),
    comments: optionalText(5000),
    dateOfBirth: optionalText(20),
    gender: optionalText(40),
  }).default({}),
  siteVisit: z.object({
    required: z.boolean().default(false),
    date: optionalText(20),
    time: optionalText(10),
    projectId: optionalText(100),
    visitorCount: z.coerce.number().int().min(1).max(50).optional().nullable(),
    visitType: optionalText(100),
    preferredLocation: optionalText(150),
    transportRequired: z.boolean().optional().nullable(),
    comments: optionalText(2000),
  }).default({}),
  company: z.object({
    name: optionalText(200),
    type: optionalText(100),
    industry: z.nativeEnum(Industry).optional().nullable().or(z.literal('')),
    email: z.string().trim().email().max(254).optional().or(z.literal('')),
    phone: optionalText(30),
    website: z.string().trim().url().max(500).optional().or(z.literal('')),
    address: optionalText(500),
    city: optionalText(100),
    state: optionalText(100),
    country: optionalText(100),
    postalCode: optionalText(20),
    designation: optionalText(100),
    department: optionalText(100),
    numberOfEmployees: z.coerce.number().int().min(0).max(10_000_000).optional().nullable(),
    gstNumber: optionalText(30),
    comments: optionalText(2000),
  }).default({}),
}).strict();

export const greSubmissionSchema = greDraftSchema.superRefine((draft, ctx) => {
  if (!draft.siteVisit.required || !draft.siteVisit.date || !draft.siteVisit.time || !draft.siteVisit.projectId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['siteVisit'],
      message: 'Site visit date, time, and project are required',
    });
  }
});

export const submissionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  phone: z.string().trim().max(30).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  leadStatus: z.nativeEnum(LeadStatus).optional(),
  siteVisitStatus: z.nativeEnum(SiteVisitStatus).optional(),
  existingLead: z.enum(['true', 'false']).optional(),
  projectId: z.string().trim().min(1).max(100).optional(),
});

export function getGreLeadStatus(hasCompletedSiteVisit: boolean, existingStatus?: LeadStatus): LeadStatus {
  return hasCompletedSiteVisit ? LeadStatus.SITE_VISIT_HAPPENED : existingStatus ?? LeadStatus.NEW;
}

export function selectScheduledVisitToComplete<T extends { id: string; scheduledAt: Date }>(
  visits: T[],
  completedAt: Date,
): T | null {
  return [...visits].sort((left, right) => {
    const timeDifference = Math.abs(left.scheduledAt.getTime() - completedAt.getTime())
      - Math.abs(right.scheduledAt.getTime() - completedAt.getTime());
    return timeDifference || left.scheduledAt.getTime() - right.scheduledAt.getTime() || left.id.localeCompare(right.id);
  })[0] ?? null;
}

type GreDraft = z.infer<typeof greDraftSchema>;

const publicLeadSelect = {
  id: true,
  companyId: true,
  leadNumber: true,
  firstName: true,
  lastName: true,
  title: true,
  email: true,
  phone: true,
  mobile: true,
  secondaryPhone: true,
  tertiaryPhone: true,
  company: true,
  industry: true,
  budget: true,
  requirements: true,
  source: true,
  status: true,
  leadSubSource: true,
  campaign: true,
  leadType: true,
  preferredLocation: true,
  occupation: true,
  gender: true,
  projectId: true,
  project: { select: { id: true, name: true, city: true } },
  siteVisits: { select: { projectId: true, status: true, scheduledAt: true, visitType: true } },
  companyAccount: {
    select: {
      id: true,
      name: true,
      companyType: true,
      industry: true,
      email: true,
      phone: true,
      website: true,
      city: true,
      state: true,
      country: true,
    },
  },
} satisfies Prisma.LeadSelect;

export function normalizePhone(countryCode: string, value: string): string | null {
  const digits = value.replace(/\D/g, '');
  const dialCode = countryCode.replace(/\D/g, '');
  if (!digits || !dialCode) return null;
  let nationalNumber = digits;
  if (nationalNumber.startsWith('00')) nationalNumber = nationalNumber.slice(2);
  if (nationalNumber.startsWith(dialCode) && nationalNumber.length > 10) {
    nationalNumber = nationalNumber.slice(dialCode.length);
  }
  nationalNumber = nationalNumber.replace(/^0+/, '');
  const length = nationalNumber.length;
  if (length < 7 || length > 12) return null;
  return `+${dialCode}${nationalNumber}`;
}

export function normalizeStoredPhone(value: string | null, countryCode: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) {
    const dialCode = countryCode?.replace(/\D/g, '');
    return dialCode === '91' ? `+91${digits}` : null;
  }
  if (digits.startsWith('91') && digits.length === 12) return `+${digits}`;
  if (digits.length >= 7 && digits.length <= 15) return `+${digits}`;
  return null;
}

export function phoneSearchVariants(normalizedPhone: string, countryCode: string | null, originalPhone?: string | null): string[] {
  const digits = normalizedPhone.replace(/\D/g, '');
  const dialCode = countryCode?.replace(/\D/g, '') || '';
  const nationalNumber = dialCode && digits.startsWith(dialCode) ? digits.slice(dialCode.length) : digits;
  return [...new Set([
    normalizedPhone,
    digits,
    nationalNumber,
    `0${nationalNumber}`,
    `+${nationalNumber}`,
    originalPhone?.trim(),
  ].filter((value): value is string => Boolean(value)))];
}

async function findMatchingLeads(
  client: Pick<typeof prisma, 'lead'>,
  tenantId: string,
  phone: string,
  countryCode: string | null,
  originalPhone?: string | null,
) {
  const variants = phoneSearchVariants(phone, countryCode, originalPhone);
  const fields = ['phone', 'mobile', 'secondaryPhone', 'tertiaryPhone'] as const;
  const leads = await client.lead.findMany({
    where: {
      tenantId,
      OR: fields.map((field) => ({ [field]: { in: variants } })),
    },
    select: {
      ...publicLeadSelect,
    },
  });
  return leads.filter((lead) =>
    [lead.phone, lead.mobile, lead.secondaryPhone, lead.tertiaryPhone]
      .some((candidate) => normalizeStoredPhone(candidate, countryCode) === phone),
  );
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function publicBaseUrl(): string {
  const configured = process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL;
  if (configured) return configured.replace(/\/+$/, '');
  return process.env.CORS_ORIGIN || 'http://localhost:3000';
}

function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function parseLocalDateTime(dateValue: string, timeValue: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || !/^\d{2}:\d{2}$/.test(timeValue)) return null;
  const date = parseDateOnly(dateValue);
  if (!date) return null;
  const [hours, minutes] = timeValue.split(':').map(Number);
  if (hours > 23 || minutes > 59) return null;
  date.setHours(hours, minutes, 0, 0);
  return date;
}

async function getActiveForm(token: string) {
  const form = await prisma.greForm.findUnique({
    where: { publicToken: token },
    include: { tenant: { select: { id: true, name: true, isActive: true } } },
  });
  if (!form || !form.isActive || !form.tenant.isActive) return null;
  if (form.expiresAt && form.expiresAt <= new Date()) return null;
  return form;
}

function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user?.isSuperAdmin && !req.user?.isAdmin) {
    return res.status(403).json({ success: false, error: 'Administrator access is required' });
  }
  next();
}

async function getSession(req: Request, res: Response) {
  const form = await getActiveForm(req.params.token);
  if (!form) {
    res.status(410).json({ success: false, error: 'This GRE link is unavailable or has expired' });
    return null;
  }
  const sessionToken = req.get('x-gre-session');
  if (!sessionToken || sessionToken.length < 32) {
    res.status(401).json({ success: false, error: 'GRE session is missing or expired' });
    return null;
  }
  const session = await prisma.greSession.findFirst({
    where: { formId: form.id, sessionTokenHash: tokenHash(sessionToken) },
  });
  if (!session || session.status === 'CANCELLED' || session.status === 'EXPIRED') {
    res.status(401).json({ success: false, error: 'GRE session is missing or expired' });
    return null;
  }
  if (session.status === 'COMPLETED') {
    res.status(409).json({ success: false, error: 'This form has already been submitted', referenceNumber: session.referenceNumber });
    return null;
  }
  if (session.expiresAt <= new Date()) {
    await prisma.greSession.update({ where: { id: session.id }, data: { status: 'EXPIRED' } });
    res.status(410).json({ success: false, error: 'Your form session has expired. Please start again.' });
    return null;
  }
  return { form, session };
}

const adminRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false });

publicRouter.get('/:token', async (req, res) => {
  try {
    const form = await getActiveForm(req.params.token);
    if (!form) return res.status(410).json({ success: false, error: 'This GRE link is unavailable or has expired' });
    const projects = await prisma.project.findMany({
      where: { tenantId: form.tenantId, isActive: true },
      select: { id: true, name: true, city: true },
      orderBy: { name: 'asc' },
    });
    res.json({
      success: true,
      data: {
        formName: form.name,
        tenantName: form.tenant.name,
        defaultProjectId: form.defaultProjectId,
        projects,
      },
    });
  } catch (error) {
    console.error('Load public GRE form error:', error);
    res.status(500).json({ success: false, error: 'Unable to load this form' });
  }
});

publicRouter.post('/:token/sessions', publicLimiter, async (req, res) => {
  try {
    const form = await getActiveForm(req.params.token);
    if (!form) return res.status(410).json({ success: false, error: 'This GRE link is unavailable or has expired' });
    const parsed = phoneCheckSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: 'Please enter a valid phone number' });
    const normalizedPhone = normalizePhone(parsed.data.countryCode, parsed.data.phone);
    if (!normalizedPhone) return res.status(400).json({ success: false, error: 'Please enter a valid phone number' });
    const normalizedAlternatePhone = parsed.data.alternatePhone
      ? normalizePhone(parsed.data.countryCode, parsed.data.alternatePhone)
      : null;
    if (parsed.data.alternatePhone && !normalizedAlternatePhone) {
      return res.status(400).json({ success: false, error: 'Please enter a valid alternate phone number' });
    }

    const matches = await findMatchingLeads(prisma, form.tenantId, normalizedPhone, parsed.data.countryCode, parsed.data.phone);
    if (matches.length > 1) {
      return res.status(409).json({ success: false, error: 'We could not safely match this number to one CRM record. Please contact the team that shared this form.' });
    }
    const sessionToken = randomBytes(32).toString('base64url');
    const session = await prisma.$transaction(async (tx) => {
      const existingLead = matches[0]
        ? await tx.lead.findFirst({
          where: { id: matches[0].id, tenantId: form.tenantId },
          select: { ownerId: true },
        })
        : null;
      const createdSession = await tx.greSession.create({
        data: {
          tenantId: form.tenantId,
          formId: form.id,
          sessionTokenHash: tokenHash(sessionToken),
          phoneCountryCode: parsed.data.countryCode,
          phone: parsed.data.phone.trim(),
          normalizedPhone,
          leadId: matches.length === 1 ? matches[0].id : undefined,
          leadWasExisting: matches.length > 0,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          currentStep: 2,
          status: 'IN_PROGRESS',
          draft: { lead: { secondaryPhone: normalizedAlternatePhone || '' }, siteVisit: { required: false }, company: {} },
        },
      });
      if (existingLead?.ownerId) {
        const projectName = matches[0].project?.name;
        await tx.notification.create({
          data: {
            tenantId: form.tenantId,
            userId: existingLead.ownerId,
            title: 'GRE registration started',
            message: `An existing lead started a GRE registration${projectName ? ` for ${projectName}` : ''}.`,
            type: 'GRE_REGISTRATION',
            referenceId: matches[0].id,
            referenceType: 'Lead',
          },
        });
      }
      return createdSession;
    });
    res.status(201).json({
      success: true,
      data: {
        sessionId: session.id,
        sessionToken,
        leadExists: matches.length > 0,
        leadDetails: matches[0] || null,
        alternatePhone: normalizedAlternatePhone,
        message: matches.length
          ? 'An existing CRM record will be used for this enquiry.'
          : 'No existing information was found. Please enter your details.',
      },
    });
  } catch (error) {
    console.error('Create GRE session error:', error);
    res.status(500).json({ success: false, error: 'Unable to start your form. Please try again.' });
  }
});

publicRouter.get('/:token/session', async (req, res) => {
  try {
    const context = await getSession(req, res);
    if (!context) return;
    const leadDetails = context.session.leadId
      ? await prisma.lead.findFirst({
        where: { id: context.session.leadId, tenantId: context.form.tenantId },
        select: publicLeadSelect,
      })
      : null;
    res.json({
      success: true,
      data: {
        currentStep: context.session.currentStep,
        draft: context.session.draft,
        countryCode: context.session.phoneCountryCode,
        phone: context.session.phone,
        leadExists: context.session.leadWasExisting,
        leadDetails,
        expiresAt: context.session.expiresAt,
      },
    });
  } catch (error) {
    console.error('Get GRE session error:', error);
    res.status(500).json({ success: false, error: 'Unable to restore your form session' });
  }
});

publicRouter.put('/:token/session', async (req, res) => {
  try {
    const context = await getSession(req, res);
    if (!context) return;
    const parsed = greDraftSchema.safeParse(req.body.draft);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Please check the form values' });
    }
    const currentStep = z.number().int().min(2).max(5).safeParse(req.body.currentStep);
    const session = await prisma.greSession.update({
      where: { id: context.session.id },
      data: {
        draft: parsed.data as Prisma.InputJsonValue,
        currentStep: currentStep.success ? currentStep.data : context.session.currentStep,
        status: 'IN_PROGRESS',
      },
    });
    res.json({ success: true, data: { currentStep: session.currentStep, savedAt: session.updatedAt } });
  } catch (error) {
    console.error('Save GRE session error:', error);
    res.status(500).json({ success: false, error: 'Unable to save your form. Please try again.' });
  }
});

publicRouter.post('/:token/submit', async (req, res) => {
  try {
    const context = await getSession(req, res);
    if (!context) return;
    const parsed = greSubmissionSchema.safeParse(req.body.draft);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Please review your form' });
    const draft: GreDraft = parsed.data;
    const session = context.session;
    const phone = session.normalizedPhone;
    if (!phone) return res.status(400).json({ success: false, error: 'Please verify your phone number first' });
    const firstName = draft.lead.firstName?.trim() || '';
    const lastName = draft.lead.lastName?.trim() || '';
    const siteVisitAt = draft.siteVisit.required
      ? parseLocalDateTime(draft.siteVisit.date!, draft.siteVisit.time!)
      : null;
    if (!siteVisitAt || siteVisitAt > new Date()) {
      return res.status(400).json({ success: false, error: 'Site visit date and time must be valid and cannot be in the future' });
    }
    if (draft.lead.projectId) {
      const project = await prisma.project.findFirst({ where: { id: draft.lead.projectId, tenantId: context.form.tenantId, isActive: true }, select: { id: true } });
      if (!project) return res.status(400).json({ success: false, error: 'Selected project is unavailable' });
    }
    if (draft.siteVisit.required) {
      const project = await prisma.project.findFirst({ where: { id: draft.siteVisit.projectId!, tenantId: context.form.tenantId, isActive: true }, select: { id: true } });
      if (!project) return res.status(400).json({ success: false, error: 'Selected site visit project is unavailable' });
    }
    if (draft.lead.dateOfBirth) {
      const dateOfBirth = parseDateOnly(draft.lead.dateOfBirth);
      if (!dateOfBirth || dateOfBirth > new Date()) {
        return res.status(400).json({ success: false, error: 'Date of birth must be a valid date in the past' });
      }
    }
    const companyName = draft.company.name?.trim() || null;
    const normalizedCompanyName = companyName?.toLowerCase().replace(/\s+/g, ' ') || null;
    const normalizedGst = draft.company.gstNumber?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || null;

    const submitted = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.form.tenantId}:GRE:SESSION:${session.id}`}, 0))`;
      const currentSession = await tx.greSession.findUnique({
        where: { id: session.id },
        select: { status: true, referenceNumber: true },
      });
      if (currentSession?.status === 'COMPLETED') {
        throw Object.assign(new Error(`This form has already been submitted${currentSession.referenceNumber ? ` (${currentSession.referenceNumber})` : ''}`), { statusCode: 409 });
      }

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.form.tenantId}:GRE:PHONE:${phone}`}, 0))`;
      if (normalizedCompanyName) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.form.tenantId}:GRE:COMPANY:${normalizedCompanyName}`}, 0))`;
      }
      if (normalizedGst) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.form.tenantId}:GRE:GST:${normalizedGst}`}, 0))`;
      }

      const matchingLeads = await findMatchingLeads(tx, context.form.tenantId, phone, session.phoneCountryCode, session.phone);
      if (matchingLeads.length > 1) {
        throw Object.assign(new Error('We could not safely match this number to one CRM record. Please contact the team that shared this form.'), { statusCode: 409 });
      }
      const existingLead = matchingLeads[0] ?? null;
      const existingLeadOwner = existingLead
        ? await tx.lead.findFirst({
          where: { id: existingLead.id, tenantId: context.form.tenantId },
          select: {
            ownerId: true,
            source: true,
            leadSubSource: true,
            rating: true,
            owner: { select: { profile: { select: { name: true } } } },
          },
        })
        : null;
      if (!existingLead && !lastName) {
        throw Object.assign(new Error('Last name is required'), { statusCode: 400 });
      }

      let company: { id: string; name: string } | null = null;
      if (existingLead?.companyId) {
        company = await tx.company.findFirst({
          where: { id: existingLead.companyId, tenantId: context.form.tenantId },
          select: { id: true, name: true },
        });
      } else if (!existingLead && companyName && normalizedCompanyName) {
        company = await tx.company.findFirst({
          where: {
            tenantId: context.form.tenantId,
            OR: [
              { normalizedName: normalizedCompanyName },
              ...(normalizedGst ? [{ normalizedGst }] : []),
            ],
          },
          select: { id: true, name: true },
        });
        const companyData = {
          name: companyName,
          normalizedName: normalizedCompanyName,
          companyType: draft.company.type || undefined,
          industry: draft.company.industry || undefined,
          email: draft.company.email || undefined,
          phone: draft.company.phone || undefined,
          website: draft.company.website || undefined,
          address: draft.company.address || undefined,
          city: draft.company.city || undefined,
          state: draft.company.state || undefined,
          country: draft.company.country || undefined,
          postalCode: draft.company.postalCode || undefined,
          designation: draft.company.designation || undefined,
          department: draft.company.department || undefined,
          numberOfEmployees: draft.company.numberOfEmployees ?? undefined,
          gstNumber: draft.company.gstNumber || undefined,
          normalizedGst: normalizedGst || undefined,
          comments: draft.company.comments || undefined,
        };
        if (!company) {
          company = await tx.company.create({
            data: { tenantId: context.form.tenantId, ...companyData },
            select: { id: true, name: true },
          });
        }
      }

      const selectedProjectId = draft.siteVisit.required ? draft.siteVisit.projectId : draft.lead.projectId;
      if (!selectedProjectId) {
        throw Object.assign(new Error('Please select a project for this Site Visit'), { statusCode: 400 });
      }
      const leadData = {
        ...(firstName ? { firstName } : {}),
        lastName,
        ...(draft.lead.secondaryPhone ? { secondaryPhone: draft.lead.secondaryPhone } : {}),
        ...(draft.lead.tertiaryPhone ? { tertiaryPhone: draft.lead.tertiaryPhone } : {}),
        ...(draft.lead.email ? { email: draft.lead.email.toLowerCase() } : {}),
        ...(draft.lead.alternateEmail ? { alternateEmail: draft.lead.alternateEmail.toLowerCase() } : {}),
        ...(draft.lead.leadSubSource ? { leadSubSource: draft.lead.leadSubSource } : {}),
        ...(draft.lead.campaign ? { campaign: draft.lead.campaign } : {}),
        ...(draft.lead.leadType ? { leadType: draft.lead.leadType } : {}),
        ...(draft.lead.preferredLocation ? { preferredLocation: draft.lead.preferredLocation } : {}),
        ...(draft.lead.budget != null ? { budget: draft.lead.budget } : {}),
        ...(draft.lead.occupation ? { occupation: draft.lead.occupation } : {}),
        ...(draft.lead.comments ? { notes: draft.lead.comments } : {}),
        ...(draft.lead.dateOfBirth ? { dateOfBirth: new Date(draft.lead.dateOfBirth) } : {}),
        ...(draft.lead.gender ? { gender: draft.lead.gender } : {}),
        ...(selectedProjectId ? { projectId: selectedProjectId } : {}),
        phone,
        ...(company ? { company: company.name, companyId: company.id } : {}),
        ...(draft.company.type ? { companyType: draft.company.type } : {}),
        ...(draft.company.email ? { companyEmail: draft.company.email.toLowerCase() } : {}),
        ...(draft.company.phone ? { companyPhone: draft.company.phone } : {}),
        ...(draft.company.designation ? { designation: draft.company.designation } : {}),
        ...(draft.company.department ? { department: draft.company.department } : {}),
        ...(draft.company.gstNumber ? { gstNumber: draft.company.gstNumber } : {}),
        ...(draft.company.comments ? { companyComments: draft.company.comments } : {}),
        ...(draft.company.website ? { website: draft.company.website } : {}),
        ...(draft.company.address ? { street: draft.company.address } : {}),
        ...(draft.company.city ? { city: draft.company.city } : {}),
        ...(draft.company.state ? { stateProvince: draft.company.state } : {}),
        ...(draft.company.country ? { country: draft.company.country } : {}),
        ...(draft.company.postalCode ? { postalCode: draft.company.postalCode } : {}),
        ...(draft.company.industry ? { industry: draft.company.industry } : {}),
        ...(draft.company.numberOfEmployees != null ? { numberOfEmployees: draft.company.numberOfEmployees } : {}),
      };

      let lead: { id: string; leadNumber: string | null };
      let leadStatusChanged = false;
      if (existingLead) {
        const status = getGreLeadStatus(draft.siteVisit.required, existingLead.status);
        leadStatusChanged = status !== existingLead.status;
        lead = leadStatusChanged
          ? await tx.lead.update({
            where: { id: existingLead.id },
            data: { status },
            select: { id: true, leadNumber: true },
          })
          : { id: existingLead.id, leadNumber: null };
      } else {
        const leadSequence = await tx.sequence.upsert({
          where: { tenantId_type: { tenantId: context.form.tenantId, type: 'LEAD' } },
          update: { nextValue: { increment: 1 } },
          create: { tenantId: context.form.tenantId, type: 'LEAD', nextValue: 1 },
        });
        lead = await tx.lead.create({
          data: {
            tenantId: context.form.tenantId,
            creatorId: context.form.createdById,
            leadNumber: `LN${String(leadSequence.nextValue).padStart(6, '0')}`,
            company: company?.name || [firstName, lastName].filter(Boolean).join(' '),
            source: 'WEBSITE',
            status: getGreLeadStatus(draft.siteVisit.required),
            ...leadData,
          },
          select: { id: true, leadNumber: true },
        });
      }

      const latestLeadVisit = existingLead
        ? await tx.siteVisit.findFirst({
          where: { tenantId: context.form.tenantId, leadId: lead.id },
          orderBy: { createdAt: 'desc' },
          select: { projectId: true },
        })
        : null;
      const newProjectVisit = isNewProjectSiteVisit(existingLead?.id ?? null, latestLeadVisit, selectedProjectId);
      const previousProjectVisit = existingLead
        ? await tx.siteVisit.findFirst({
          where: { tenantId: context.form.tenantId, leadId: lead.id, projectId: selectedProjectId },
          orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
          select: {
            projectId: true,
            assigneeId: true,
            assignee: { select: { firstName: true, lastName: true, email: true } },
          },
        })
        : null;
      const scheduledProjectVisits = existingLead && !newProjectVisit
        ? await tx.siteVisit.findMany({
          where: {
            tenantId: context.form.tenantId,
            leadId: lead.id,
            projectId: selectedProjectId,
            status: 'SCHEDULED',
          },
          orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            scheduledAt: true,
            completedAt: true,
            status: true,
            projectId: true,
            assigneeId: true,
            createdAt: true,
            notes: true,
            completionNotes: true,
            visitorCount: true,
            visitType: true,
            transportRequired: true,
            assignee: { select: { firstName: true, lastName: true, email: true } },
          },
        })
        : [];
      const scheduledVisitToComplete = selectScheduledVisitToComplete(scheduledProjectVisits, siteVisitAt!);
      const reusableOwnerId = getReusableSiteVisitOwner(existingLead?.id ?? null, previousProjectVisit, selectedProjectId);
      const isRevisit = isSiteVisitRevisit(existingLead?.id ?? null, previousProjectVisit, selectedProjectId)
        || Boolean(scheduledVisitToComplete);
      const siteVisitType = isRevisit ? 'REVISIT' : draft.siteVisit.visitType || undefined;
      let rrQueue: Awaited<ReturnType<typeof findApplicableRRQueue>> = null;
      const retainedOwnerId = newProjectVisit ? null : scheduledVisitToComplete?.assigneeId || reusableOwnerId;
      if (!retainedOwnerId) {
        rrQueue = await findApplicableRRQueue(context.form.tenantId, {
          projectId: selectedProjectId,
          status: 'NEW',
          source: 'WEBSITE',
          secondarySource: existingLead?.leadSubSource || draft.lead.leadSubSource || null,
        }, tx);
      }

      const siteVisitNotes = [
        `GRE registration: ${context.form.name}`,
        `Visit category: ${isRevisit ? 'Revisit' : 'First Visit'}`,
        draft.siteVisit.visitType ? `Visit type: ${draft.siteVisit.visitType}` : '',
        draft.siteVisit.preferredLocation ? `Location: ${draft.siteVisit.preferredLocation}` : '',
        draft.siteVisit.comments,
      ].filter(Boolean).join('\n');
      const siteVisitSelect = {
        id: true,
        scheduledAt: true,
        completedAt: true,
        status: true,
        projectId: true,
        createdAt: true,
        assigneeId: true,
      } as const;
      const siteVisit = scheduledVisitToComplete
        ? await tx.siteVisit.update({
          where: { id: scheduledVisitToComplete.id },
          data: {
            assigneeId: retainedOwnerId,
            completedAt: siteVisitAt!,
            completedById: context.form.createdById,
            status: 'COMPLETED',
            completionNotes: [scheduledVisitToComplete.completionNotes, siteVisitNotes].filter(Boolean).join('\n'),
            visitorCount: draft.siteVisit.visitorCount ?? scheduledVisitToComplete.visitorCount ?? 1,
            visitType: siteVisitType,
            transportRequired: draft.siteVisit.transportRequired ?? scheduledVisitToComplete.transportRequired ?? false,
          },
          select: siteVisitSelect,
        })
        : await tx.siteVisit.create({
          data: {
          tenantId: context.form.tenantId,
          leadId: lead.id,
          projectId: draft.siteVisit.projectId,
          creatorId: context.form.createdById,
          assigneeId: retainedOwnerId,
          siteVisitNumber: await getNextSiteVisitNumber(tx, context.form.tenantId),
          scheduledAt: siteVisitAt!,
          completedAt: siteVisitAt!,
          status: 'COMPLETED',
          notes: siteVisitNotes,
          completionNotes: siteVisitNotes,
          visitorCount: draft.siteVisit.visitorCount ?? 1,
          visitType: siteVisitType,
          transportRequired: draft.siteVisit.transportRequired ?? false,
        },
        select: siteVisitSelect,
      });
      let assignment: {
        queueId: string | null;
        assignedUserId: string | null;
        assignedUserName: string | null;
        reused: boolean;
        warning?: string;
      };
      if (siteVisit.assigneeId) {
        assignment = {
          queueId: null,
          assignedUserId: siteVisit.assigneeId,
          assignedUserName: [
            scheduledVisitToComplete?.assignee?.firstName || previousProjectVisit?.assignee?.firstName,
            scheduledVisitToComplete?.assignee?.lastName || previousProjectVisit?.assignee?.lastName,
          ].filter(Boolean).join(' ').trim() || previousProjectVisit?.assignee?.email || 'Existing Site Visit Owner',
          reused: true,
        };
      } else if (rrQueue) {
        try {
          assignment = {
            ...await RoundRobinAssignmentService.assignSiteVisitInTransaction(
              tx,
              rrQueue.id,
              siteVisit.id,
              lead.id,
              context.form.tenantId,
            ),
            reused: false,
          };
        } catch (error) {
          if (!(error instanceof Error) || !['NO_ELIGIBLE_USER', 'RR_QUEUE_NOT_FOUND'].includes(error.message)) throw error;
          assignment = {
            queueId: rrQueue.id,
            assignedUserId: null,
            assignedUserName: null,
            reused: false,
            warning: 'The Site Visit was saved, but no active Sales user was available for assignment.',
          };
        }
      } else {
        assignment = {
          queueId: null,
          assignedUserId: null,
          assignedUserName: null,
          reused: false,
          warning: 'The Site Visit was saved, but no active Round Robin queue matches this project and lead source.',
        };
      }
      if (!existingLead) {
        if (assignment.assignedUserId) {
          await tx.lead.update({
            where: { id: lead.id },
            data: { ownerId: assignment.assignedUserId, rrQueueId: assignment.queueId },
          });
          await createOwnerHistory({
            tenantId: context.form.tenantId,
            leadId: lead.id,
            previousOwnerId: null,
            newOwnerId: assignment.assignedUserId,
            previousProfile: null,
            newProfile: null,
            previousStatus: null,
            newStatus: getGreLeadStatus(draft.siteVisit.required),
            handoffReason: 'GRE initial Sales assignment',
            changedById: context.form.createdById,
          }, tx);
        }
      } else if (draft.siteVisit.required && existingLeadOwner?.owner?.profile?.name === 'SVC') {
        const salesQueue = await findApplicableRRQueue(context.form.tenantId, {
          projectId: selectedProjectId,
          status: getGreLeadStatus(true, existingLead.status),
          source: existingLeadOwner.source,
          secondarySource: existingLeadOwner.leadSubSource,
          priority: existingLeadOwner.rating,
        }, tx);
        if (!salesQueue) {
          throw Object.assign(new Error('No Sales Round Robin queue matches this project.'), { statusCode: 503 });
        }
        const salesAssignment = await RoundRobinAssignmentService.assignLeadInTransaction(
          tx,
          salesQueue.id,
          lead.id,
          context.form.tenantId,
        );
        const salesOwner = await tx.user.findFirst({
          where: { id: salesAssignment.assignedUserId, tenantId: context.form.tenantId },
          select: { profile: { select: { name: true } } },
        });
        await createOwnerHistory({
          tenantId: context.form.tenantId,
          leadId: lead.id,
          previousOwnerId: existingLeadOwner.ownerId,
          newOwnerId: salesAssignment.assignedUserId,
          previousProfile: 'SVC',
          newProfile: salesOwner?.profile?.name || null,
          previousStatus: existingLead.status,
          newStatus: getGreLeadStatus(true, existingLead.status),
          handoffReason: `GRE Site Visit completed for project ${selectedProjectId}`,
          changedById: context.form.createdById,
        }, tx);
      }

      const seq = await tx.sequence.upsert({
        where: { tenantId_type: { tenantId: context.form.tenantId, type: 'GRE' } },
        update: { nextValue: { increment: 1 } },
        create: { tenantId: context.form.tenantId, type: 'GRE', nextValue: 1 },
      });
      const referenceNumber = `GRE-${new Date().getFullYear()}-${String(seq.nextValue).padStart(6, '0')}`;
      await tx.greSession.update({
        where: { id: session.id },
        data: {
          leadId: lead.id,
          companyId: existingLead?.companyId || company?.id,
          siteVisitId: siteVisit?.id,
          referenceNumber,
          leadWasExisting: matchingLeads.length > 0,
          status: 'COMPLETED',
          currentStep: 6,
          draft: parsed.data as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: context.form.tenantId,
          userId: context.form.createdById,
          leadId: lead.id,
          action: existingLead ? 'GRE_LEAD_REUSED' : 'GRE_LEAD_CREATED',
          objectType: 'Lead',
          objectId: lead.id,
          oldValues: existingLead ? { status: existingLead.status } : undefined,
          newValues: {
            greSessionId: session.id,
            referenceNumber,
            companyId: existingLead?.companyId || company?.id,
            siteVisitId: siteVisit?.id,
            status: getGreLeadStatus(draft.siteVisit.required, existingLead?.status),
            leadStatusChanged,
            rrQueueId: assignment.queueId,
            siteVisitOwnerId: assignment.assignedUserId,
            siteVisitOwnerReused: assignment.reused,
            siteVisitAssignmentWarning: assignment.warning ?? null,
            siteVisitType: siteVisitType ?? null,
            siteVisitCategory: isRevisit ? 'REVISIT' : 'FIRST_VISIT',
            scheduledVisitCompleted: Boolean(scheduledVisitToComplete),
          },
        },
      });
      if (company && !existingLead) {
        await tx.auditLog.create({
          data: {
            tenantId: context.form.tenantId,
            userId: context.form.createdById,
            leadId: lead.id,
            action: 'GRE_COMPANY_LINKED_OR_CREATED',
            objectType: 'Company',
            objectId: company.id,
            newValues: { greSessionId: session.id, referenceNumber },
          },
        });
      }
      if (siteVisit) {
        await tx.auditLog.create({
          data: {
            tenantId: context.form.tenantId,
            userId: context.form.createdById,
            leadId: lead.id,
            action: 'GRE_SITE_VISIT_COMPLETED',
            objectType: 'SiteVisit',
            objectId: siteVisit.id,
            newValues: {
              greSessionId: session.id,
              referenceNumber,
              status: siteVisit.status,
              scheduledAt: siteVisit.scheduledAt,
              completedAt: siteVisit.completedAt,
              projectId: siteVisit.projectId,
              assigneeId: assignment.assignedUserId,
              assignedTo: assignment.assignedUserName,
              roundRobinReused: assignment.reused,
              visitType: siteVisitType,
              visitCategory: isRevisit ? 'REVISIT' : 'FIRST_VISIT',
              scheduledVisitCompleted: Boolean(scheduledVisitToComplete),
            },
          },
        });
      }

      return {
        referenceNumber,
        leadWasExisting: matchingLeads.length > 0,
        leadId: lead.id,
        siteVisit,
        scheduledVisitCompleted: Boolean(scheduledVisitToComplete),
        assignment: {
          queueId: assignment.queueId,
          assignedTo: assignment.assignedUserName,
          warning: assignment.warning ?? null,
        },
      };
    });

    res.json({
      success: true,
      data: {
        referenceNumber: submitted.referenceNumber,
        siteVisit: submitted.siteVisit ? {
          id: submitted.siteVisit.id,
          scheduledAt: submitted.siteVisit.scheduledAt,
          completedAt: submitted.siteVisit.completedAt,
          status: submitted.siteVisit.status,
          projectId: submitted.siteVisit.projectId,
          createdAt: submitted.siteVisit.createdAt,
        } : null,
        leadId: submitted.leadId,
        leadWasExisting: submitted.leadWasExisting,
        scheduledVisitCompleted: submitted.scheduledVisitCompleted,
        assignment: submitted.assignment,
      },
    });
  } catch (error) {
    const statusCode = error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (statusCode === 409 || statusCode === 400 || statusCode === 503) {
      return res.status(statusCode).json({ success: false, error: error instanceof Error ? error.message : 'Unable to submit GRE form' });
    }
    if (error instanceof Error && error.message === 'NO_ELIGIBLE_USER') {
      return res.status(503).json({ success: false, error: 'The matching Round Robin queue has no active Sales users. Please contact the CRM team before submitting.' });
    }
    if (error instanceof Error && error.message === 'PROJECT_RR_QUEUE_NOT_FOUND') {
      return res.status(503).json({ success: false, error: 'No Sales Round Robin queue matches this project. Please contact the CRM team before submitting.' });
    }
    if (error instanceof Error && error.message === 'RR_QUEUE_NOT_FOUND') {
      return res.status(503).json({ success: false, error: 'The matching Round Robin queue is no longer available. Please retry or contact the CRM team.' });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ success: false, error: 'A matching phone number was submitted at the same time. Please retry the form.' });
    }
    console.error('Submit GRE form error:', error);
    res.status(500).json({ success: false, error: 'Unable to submit your information. Please try again.' });
  }
});

router.use(authenticate, adminRateLimit, requireAdmin);

router.get('/forms', async (req: AuthRequest, res: Response) => {
  try {
    const forms = await prisma.greForm.findMany({
      where: { tenantId: req.tenantId! },
      include: { _count: { select: { sessions: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      success: true,
      data: forms.map((form) => ({
        id: form.id,
        name: form.name,
        publicUrl: `${publicBaseUrl()}/gre/${form.publicToken}`,
        isActive: form.isActive,
        expiresAt: form.expiresAt,
        defaultProjectId: form.defaultProjectId,
        sessions: form._count.sessions,
        createdAt: form.createdAt,
      })),
    });
  } catch (error) {
    console.error('List GRE forms error:', error);
    res.status(500).json({ success: false, error: 'Failed to list GRE forms' });
  }
});

router.post('/forms', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().trim().min(1).max(100),
      expiresAt: z.string().datetime().optional().nullable(),
      defaultProjectId: z.string().min(1).optional().nullable(),
    });
    const data = schema.parse(req.body);
    if (data.expiresAt && new Date(data.expiresAt) <= new Date()) {
      return res.status(400).json({ success: false, error: 'Expiry date must be in the future' });
    }
    if (data.defaultProjectId) {
      const project = await prisma.project.findFirst({
        where: { id: data.defaultProjectId, tenantId: req.tenantId!, isActive: true },
        select: { id: true },
      });
      if (!project) return res.status(400).json({ success: false, error: 'Default project is not available' });
    }
    const publicToken = randomBytes(32).toString('base64url');
    const form = await prisma.greForm.create({
      data: {
        tenantId: req.tenantId!,
        name: data.name,
        publicToken,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        defaultProjectId: data.defaultProjectId || null,
        createdById: req.user!.id,
      },
    });
    await prisma.auditLog.create({
      data: {
        tenantId: req.tenantId!,
        userId: req.user!.id,
        action: 'GRE_FORM_CREATED',
        objectType: 'GreForm',
        objectId: form.id,
        newValues: { name: form.name, expiresAt: form.expiresAt },
      },
    });
    res.status(201).json({
      success: true,
      data: { id: form.id, name: form.name, publicUrl: `${publicBaseUrl()}/gre/${publicToken}`, isActive: form.isActive, expiresAt: form.expiresAt },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, error: error.issues[0]?.message || 'Invalid form data' });
    console.error('Create GRE form error:', error);
    res.status(500).json({ success: false, error: 'Failed to create GRE form' });
  }
});

router.patch('/forms/:id', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().trim().min(1).max(100).optional(),
      isActive: z.boolean().optional(),
      expiresAt: z.string().datetime().nullable().optional(),
      defaultProjectId: z.string().min(1).nullable().optional(),
    }).strict();
    const data = schema.parse(req.body);
    if (data.expiresAt && new Date(data.expiresAt) <= new Date()) {
      return res.status(400).json({ success: false, error: 'Expiry date must be in the future' });
    }
    if (data.defaultProjectId) {
      const project = await prisma.project.findFirst({ where: { id: data.defaultProjectId, tenantId: req.tenantId!, isActive: true }, select: { id: true } });
      if (!project) return res.status(400).json({ success: false, error: 'Default project is not available' });
    }
    const existing = await prisma.greForm.findFirst({ where: { id: req.params.id, tenantId: req.tenantId! } });
    if (!existing) return res.status(404).json({ success: false, error: 'GRE form not found' });
    const form = await prisma.greForm.update({
      where: { id: existing.id },
      data: {
        ...data,
        ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt ? new Date(data.expiresAt) : null } : {}),
      },
    });
    await prisma.auditLog.create({
      data: {
        tenantId: req.tenantId!,
        userId: req.user!.id,
        action: 'GRE_FORM_UPDATED',
        objectType: 'GreForm',
        objectId: form.id,
        oldValues: { name: existing.name, isActive: existing.isActive, expiresAt: existing.expiresAt },
        newValues: data,
      },
    });
    res.json({ success: true, data: { id: form.id, name: form.name, publicUrl: `${publicBaseUrl()}/gre/${form.publicToken}`, isActive: form.isActive, expiresAt: form.expiresAt, defaultProjectId: form.defaultProjectId } });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, error: error.issues[0]?.message || 'Invalid form data' });
    console.error('Update GRE form error:', error);
    res.status(500).json({ success: false, error: 'Failed to update GRE form' });
  }
});

router.get('/submissions', async (req: AuthRequest, res: Response) => {
  try {
    const parsedQuery = submissionsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ success: false, error: parsedQuery.error.issues[0]?.message || 'Invalid submissions query' });
    }
    const { page, limit, phone, from, to, leadStatus, siteVisitStatus, existingLead, projectId } = parsedQuery.data;
    if (from && to && from > to) {
      return res.status(400).json({ success: false, error: 'The start date must be before or equal to the end date' });
    }
    const dateFrom = from ? new Date(`${from}T00:00:00.000Z`) : undefined;
    const dateToExclusive = to ? new Date(`${to}T00:00:00.000Z`) : undefined;
    if (dateToExclusive) dateToExclusive.setUTCDate(dateToExclusive.getUTCDate() + 1);
    const phoneDigits = phone?.replace(/\D/g, '');
    const filters: Prisma.GreSessionWhereInput[] = [];
    if (phone) {
      filters.push({
        OR: [
          { phone: { contains: phone, mode: 'insensitive' } },
          ...(phoneDigits ? [{ normalizedPhone: { contains: phoneDigits } }] : []),
        ],
      });
    }
    if (projectId) {
      filters.push({
        OR: [
          { siteVisit: { projectId } },
          { lead: { projectId } },
        ],
      });
    }
    const where: Prisma.GreSessionWhereInput = {
      tenantId: req.tenantId!,
      status: GreSessionStatus.COMPLETED,
      ...(filters.length ? { AND: filters } : {}),
      ...(existingLead === 'true' ? { leadWasExisting: true } : existingLead === 'false' ? { leadWasExisting: false } : {}),
      ...(dateFrom || dateToExclusive ? {
        createdAt: {
          ...(dateFrom ? { gte: dateFrom } : {}),
          ...(dateToExclusive ? { lt: dateToExclusive } : {}),
        },
      } : {}),
      ...(phone ? {
        OR: [
          { phone: { contains: phone, mode: 'insensitive' } },
          ...(phoneDigits ? [{ normalizedPhone: { contains: phoneDigits } }] : []),
        ],
      } : {}),
      ...(leadStatus ? { lead: { status: leadStatus } } : {}),
      ...(siteVisitStatus ? { siteVisit: { status: siteVisitStatus } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.greSession.findMany({
        where,
        include: {
          lead: { select: { id: true, firstName: true, lastName: true, phone: true, status: true, leadNumber: true, project: { select: { name: true } } } },
          company: { select: { id: true, name: true } },
          siteVisit: { select: { id: true, siteVisitNumber: true, scheduledAt: true, status: true, project: { select: { id: true, name: true } } } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.greSession.count({ where }),
    ]);
    res.json({
      success: true,
      data: rows.map((row) => ({
        id: row.id,
        referenceNumber: row.referenceNumber,
        phone: row.phone,
        name: row.lead ? [row.lead.firstName, row.lead.lastName].filter(Boolean).join(' ') : '',
        leadNumber: row.lead?.leadNumber,
        leadId: row.leadId,
        leadStatus: row.lead?.status,
        leadWasExisting: row.leadWasExisting,
        company: row.company?.name || 'Individual',
        siteVisitNumber: row.siteVisit?.siteVisitNumber,
        siteVisitAt: row.siteVisit?.scheduledAt,
        siteVisitStatus: row.siteVisit?.status,
        project: row.siteVisit?.project?.name || row.lead?.project?.name || '',
        status: row.status,
        createdAt: row.createdAt,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('List GRE submissions error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch GRE submissions' });
  }
});

export { router as greRoutes };
