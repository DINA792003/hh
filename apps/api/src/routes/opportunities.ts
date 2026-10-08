import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '@dct-crm/db';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/authorization';
import { auditLog } from '../middleware/audit';
import { getOpportunityVisibilityFilter } from '../services/recordAccess';

const router = Router();

router.use(authenticate);

const opportunitySchema = z.object({
  name: z.string().min(1).max(200),
  leadId: z.string().optional(),
  ownerId: z.string().optional(),
  queueId: z.string().optional(),
  projectId: z.string().optional(),
  stage: z.enum(['PROSPECTING', 'QUALIFICATION', 'NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST']).optional(),
  amount: z.number().min(0).optional(),
  expectedCloseDate: z.string().datetime().optional(),
  probability: z.number().min(0).max(100).optional(),
  description: z.string().max(2000).optional(),
  lostReason: z.string().max(500).optional(),
});

const updateOpportunitySchema = opportunitySchema.partial();

const opportunityInclude = {
  lead: {
    select: {
      id: true,
      leadNumber: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      mobile: true,
      company: true,
      budget: true,
      preferredLocation: true,
      project: { select: { id: true, name: true } },
      greSessions: {
        where: { status: 'COMPLETED' },
        orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: {
          referenceNumber: true,
          completedAt: true,
          phone: true,
          draft: true,
          siteVisit: {
            select: {
              scheduledAt: true,
              project: { select: { name: true } },
            },
          },
        },
      },
    },
  },
  owner: { select: { id: true, firstName: true, lastName: true } },
  creator: { select: { id: true, firstName: true, lastName: true } },
  project: { select: { id: true, name: true } },
} satisfies Prisma.OpportunityInclude;

const opportunityDetailInclude = {
  ...opportunityInclude,
  owner: { select: { id: true, firstName: true, lastName: true, email: true } },
  quotations: { select: { id: true, number: true, totalAmount: true, status: true } },
  bookings: { select: { id: true, number: true, status: true, totalAmount: true } },
  activities: { take: 10, orderBy: { createdAt: 'desc' } },
  tasks: { take: 10, orderBy: { createdAt: 'desc' } },
} satisfies Prisma.OpportunityInclude;

type OpportunityWithGre = Prisma.OpportunityGetPayload<{ include: typeof opportunityInclude }>;

function jsonProperty(value: Prisma.JsonValue | null, key: string): Prisma.JsonValue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value[key] ?? null;
}

function jsonText(value: Prisma.JsonValue | null): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function jsonNumber(value: Prisma.JsonValue | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mapOpportunity<T extends OpportunityWithGre>(opportunity: T) {
  const lead = opportunity.lead;
  const session = lead?.greSessions[0];
  const greLead = session ? jsonProperty(session.draft, 'lead') : null;
  const greSiteVisit = session ? jsonProperty(session.draft, 'siteVisit') : null;
  const greCompany = session ? jsonProperty(session.draft, 'company') : null;

  return {
    ...opportunity,
    lead: lead ? {
      id: lead.id,
      leadNumber: lead.leadNumber,
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      phone: lead.phone,
      mobile: lead.mobile,
      company: lead.company,
      budget: lead.budget,
      preferredLocation: lead.preferredLocation,
      project: lead.project,
    } : null,
    greRegistration: session ? {
      referenceNumber: session.referenceNumber,
      submittedAt: session.completedAt,
      lead: {
        firstName: jsonText(jsonProperty(greLead, 'firstName')) ?? lead?.firstName ?? null,
        lastName: jsonText(jsonProperty(greLead, 'lastName')) ?? lead?.lastName ?? null,
        email: jsonText(jsonProperty(greLead, 'email')) ?? lead?.email ?? null,
        phone: session.phone ?? lead?.phone ?? lead?.mobile ?? null,
        company: jsonText(jsonProperty(greCompany, 'name')) ?? lead?.company ?? null,
        budget: jsonNumber(jsonProperty(greLead, 'budget')) ?? lead?.budget ?? null,
        preferredLocation: jsonText(jsonProperty(greLead, 'preferredLocation')) ?? lead?.preferredLocation ?? null,
      },
      siteVisit: {
        date: jsonText(jsonProperty(greSiteVisit, 'date')),
        time: jsonText(jsonProperty(greSiteVisit, 'time')),
        project: session.siteVisit?.project?.name ?? lead?.project?.name ?? null,
        scheduledAt: session.siteVisit?.scheduledAt ?? null,
        visitType: jsonText(jsonProperty(greSiteVisit, 'visitType')),
        visitorCount: jsonNumber(jsonProperty(greSiteVisit, 'visitorCount')),
      },
      company: {
        name: jsonText(jsonProperty(greCompany, 'name')),
        type: jsonText(jsonProperty(greCompany, 'type')),
        industry: jsonText(jsonProperty(greCompany, 'industry')),
      },
    } : null,
  };
}

router.get('/', authorize('Opportunity', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId } = req.user!;
    const {
      page = 1,
      limit = 20,
      search,
      stage,
      leadId,
      ownerId,
      projectId,
      minAmount,
      maxAmount,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    const where: any = await getOpportunityVisibilityFilter(tenantId, req.user!.id, 'read');
    if (stage) where.stage = stage;
    if (leadId) where.leadId = leadId;
    if (ownerId) where.ownerId = ownerId;
    if (projectId) where.projectId = projectId;
    if (minAmount) where.amount = { ...where.amount, gte: Number(minAmount) };
    if (maxAmount) where.amount = { ...where.amount, lte: Number(maxAmount) };
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const [opportunities, total] = await Promise.all([
      prisma.opportunity.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { [sortBy as string]: sortOrder },
        include: {
          ...opportunityInclude,
          _count: { select: { quotations: true, bookings: true, activities: true } },
        },
      }),
      prisma.opportunity.count({ where }),
    ]);

    res.json({
      success: true,
      data: opportunities.map(mapOpportunity),
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get opportunities error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch opportunities' });
  }
});

router.get('/:id', authorize('Opportunity', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId } = req.user!;

    const opportunity = await prisma.opportunity.findFirst({
      where: { ...(await getOpportunityVisibilityFilter(tenantId, req.user!.id, 'read')), id: req.params.id },
      include: opportunityDetailInclude,
    });

    if (!opportunity) {
      return res.status(404).json({ success: false, error: 'Opportunity not found' });
    }

    res.json({ success: true, data: mapOpportunity(opportunity) });
  } catch (error) {
    console.error('Get opportunity error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch opportunity' });
  }
});

router.post('/', authorize('Opportunity', 'create'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId, id: userId } = req.user!;
    const data = opportunitySchema.parse(req.body);

    const relationChecks = await Promise.all([
      data.ownerId ? prisma.user.count({ where: { id: data.ownerId, tenantId, isActive: true } }) : 1,
      data.leadId ? prisma.lead.count({ where: { id: data.leadId, tenantId } }) : 1,
      data.queueId ? prisma.queue.count({ where: { id: data.queueId, tenantId, isActive: true } }) : 1,
      data.projectId ? prisma.project.count({ where: { id: data.projectId, tenantId, isActive: true } }) : 1,
    ]);
    if (relationChecks.some((count) => count !== 1)) {
      return res.status(400).json({ success: false, error: 'One or more related records are invalid for this tenant' });
    }

    const opportunity = await prisma.opportunity.create({
      data: {
        tenantId,
        name: data.name,
        leadId: data.leadId,
        ownerId: data.ownerId,
        creatorId: userId,
        queueId: data.queueId,
        projectId: data.projectId,
        stage: data.stage || 'PROSPECTING',
        amount: data.amount,
        expectedCloseDate: data.expectedCloseDate ? new Date(data.expectedCloseDate) : undefined,
        probability: data.probability,
        description: data.description,
        lostReason: data.lostReason,
      },
      include: {
        ...opportunityInclude,
      },
    });

    await auditLog(tenantId, userId, 'CREATE', 'Opportunity', opportunity.id, null, { name: data.name, stage: data.stage, amount: data.amount });

    res.status(201).json({ success: true, data: mapOpportunity(opportunity) });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: error.errors[0].message });
    }
    console.error('Create opportunity error:', error);
    res.status(500).json({ success: false, error: 'Failed to create opportunity' });
  }
});

router.put('/:id', authorize('Opportunity', 'edit'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId, id: userId } = req.user!;

    const existing = await prisma.opportunity.findFirst({
      where: { id: req.params.id, tenantId },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Opportunity not found' });
    }

    const data = updateOpportunitySchema.parse(req.body);

    const visible = await prisma.opportunity.findFirst({
      where: { ...(await getOpportunityVisibilityFilter(tenantId, userId, 'edit')), id: req.params.id },
      select: { id: true },
    });
    if (!visible) return res.status(403).json({ success: false, error: 'You do not have edit access to this opportunity' });

    const relationChecks = await Promise.all([
      data.ownerId ? prisma.user.count({ where: { id: data.ownerId, tenantId, isActive: true } }) : 1,
      data.leadId ? prisma.lead.count({ where: { id: data.leadId, tenantId } }) : 1,
      data.queueId ? prisma.queue.count({ where: { id: data.queueId, tenantId, isActive: true } }) : 1,
      data.projectId ? prisma.project.count({ where: { id: data.projectId, tenantId, isActive: true } }) : 1,
    ]);
    if (relationChecks.some((count) => count !== 1)) {
      return res.status(400).json({ success: false, error: 'One or more related records are invalid for this tenant' });
    }

    const opportunity = await prisma.opportunity.update({
      where: { id: req.params.id },
      data: {
        ...data,
        expectedCloseDate: data.expectedCloseDate ? new Date(data.expectedCloseDate) : undefined,
      },
      include: opportunityInclude,
    });

    await auditLog(tenantId, userId, 'UPDATE', 'Opportunity', opportunity.id, existing, opportunity);

    res.json({ success: true, data: mapOpportunity(opportunity) });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: error.errors[0].message });
    }
    console.error('Update opportunity error:', error);
    res.status(500).json({ success: false, error: 'Failed to update opportunity' });
  }
});

router.patch('/:id/stage', authorize('Opportunity', 'edit'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId, id: userId } = req.user!;

    const existing = await prisma.opportunity.findFirst({
      where: { ...(await getOpportunityVisibilityFilter(tenantId, userId, 'edit')), id: req.params.id },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Opportunity not found' });
    }

    const parsedStage = z.object({
      stage: opportunitySchema.shape.stage.unwrap(),
      lostReason: z.string().max(500).optional(),
    }).parse(req.body);
    const updateData: any = { stage: parsedStage.stage };
    if (parsedStage.stage === 'CLOSED_LOST' && parsedStage.lostReason) {
      updateData.lostReason = parsedStage.lostReason;
    }

    const opportunity = await prisma.opportunity.update({
      where: { id: req.params.id },
      data: updateData,
      include: opportunityInclude,
    });

    await auditLog(tenantId, userId, 'UPDATE', 'Opportunity', opportunity.id, existing, parsedStage);

    res.json({ success: true, data: mapOpportunity(opportunity) });
  } catch (error) {
    console.error('Update opportunity stage error:', error);
    res.status(500).json({ success: false, error: 'Failed to update opportunity stage' });
  }
});

router.delete('/:id', authorize('Opportunity', 'delete'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId, id: userId } = req.user!;

    const existing = await prisma.opportunity.findFirst({
      where: { ...(await getOpportunityVisibilityFilter(tenantId, userId, 'delete')), id: req.params.id },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Opportunity not found' });
    }

    await prisma.opportunity.delete({ where: { id: req.params.id } });

    await auditLog(tenantId, userId, 'DELETE', 'Opportunity', existing.id, existing, null);

    res.json({ success: true, data: null });
  } catch (error) {
    console.error('Delete opportunity error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete opportunity' });
  }
});

export default router;