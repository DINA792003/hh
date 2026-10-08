import { Router, Response } from 'express';
import { prisma } from '@dct-crm/db';
import { crmDateToUtcStart } from '@dct-crm/shared';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/authorization';
import { auditLog } from '../middleware/audit';
import {
  applyScope,
  canAccessLead,
  canAccessSiteVisit,
  getScopeClause,
} from '../services/recordAccess';
import { getNextSiteVisitNumber, normalizeOverdueSiteVisits } from '../services/leadWorkflowExtras';
import { canTransitionStatus } from '../services/workflow';
import { createOwnerHistory } from '../services/ownerHistory';
import { checkSiteVisitLocation } from '../services/siteVisitLocation';
import { findApplicableRRQueue, RoundRobinAssignmentService } from '../services/rrQueue';

const router = Router();

router.use(authenticate);

const siteVisitSchema = z.object({
  leadId: z.string().min(1, 'Lead ID is required'),
  projectId: z.string().min(1, 'Project is required'),
  assigneeId: z.string().optional(),
  queueId: z.string().optional(),
  scheduledAt: z.string().datetime(),
  status: z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED']).optional(),
  notes: z.string().min(1, 'Note/reason is required').max(2000),
  feedback: z.string().max(1000).optional(),
  rating: z.number().int().min(1).max(5).optional(),
});

const updateSiteVisitSchema = siteVisitSchema.partial();
const completeSiteVisitSchema = z.object({
  completedAt: z.string().datetime('Completion time is required'),
  customerFeedback: z.string().min(1, 'Customer feedback is required').refine((v) => v.trim().length > 0, 'Customer feedback is required'),
  completionNotes: z.string().min(1, 'Completion notes are required').refine((v) => v.trim().length > 0, 'Completion notes are required'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const cancelSiteVisitSchema = z.object({
  reason: z.string().min(1, 'Reason is required').refine((v) => v.trim().length > 0, {
    message: 'Reason is required',
  }),
});

const revisitSiteVisitSchema = z.object({
  reason: z.string().min(1, 'Reason is required').refine((v) => v.trim().length > 0, {
    message: 'Reason is required',
  }),
  scheduledAt: z.string().datetime({ message: 'Visit date/time is required' }),
  projectId: z.string().min(1, 'Project is required'),
  assigneeId: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

router.get('/', authorize('SiteVisit', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId } = req.user!;
    await normalizeOverdueSiteVisits(tenantId);
    const {
      page = 1,
      limit = 20,
      leadId,
      projectId,
      assigneeId,
      status,
      search,
      startDate,
      endDate,
      sortBy = 'scheduledAt',
      sortOrder = 'desc',
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    let where: any = { tenantId };
    if (leadId) where.leadId = leadId;
    if (projectId) where.projectId = projectId;
    if (assigneeId) where.assigneeId = assigneeId;
    if (status) where.status = status;
    if (search && String(search).trim()) {
      const term = String(search).trim();
      where.OR = [
        { siteVisitNumber: { contains: term, mode: 'insensitive' } },
        { lead: { leadNumber: { contains: term, mode: 'insensitive' } } },
        { lead: { firstName: { contains: term, mode: 'insensitive' } } },
        { lead: { lastName: { contains: term, mode: 'insensitive' } } },
        { lead: { phone: { contains: term } } },
        { lead: { company: { contains: term, mode: 'insensitive' } } },
        { lead: { email: { contains: term, mode: 'insensitive' } } },
      ];
    }
    if (startDate && endDate) {
      const end = crmDateToUtcStart(String(endDate));
      end.setUTCDate(end.getUTCDate() + 1);
      where.scheduledAt = {
        gte: crmDateToUtcStart(String(startDate)),
        lt: end,
      };
    }
    where = applyScope(where, await getScopeClause(req.user!, 'siteVisit'));

    const [siteVisits, total] = await Promise.all([
      prisma.siteVisit.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { [sortBy as string]: sortOrder },
        include: {
          lead: { select: { id: true, leadNumber: true, firstName: true, lastName: true, phone: true, company: true, email: true } },
          project: { select: { id: true, name: true } },
          assignee: { select: { id: true, firstName: true, lastName: true } },
          creator: { select: { id: true, firstName: true, lastName: true, email: true, profile: { select: { name: true } } } },
          completedBy: { select: { id: true, firstName: true, lastName: true, email: true, profile: { select: { name: true } } } },
          cancelledBy: { select: { id: true, firstName: true, lastName: true, email: true, profile: { select: { name: true } } } },
        },
      }),
      prisma.siteVisit.count({ where }),
    ]);

    res.json({
      success: true,
      data: siteVisits,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get site visits error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch site visits' });
  }
});

router.get('/:id', authorize('SiteVisit', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId } = req.user!;
    await normalizeOverdueSiteVisits(tenantId);

    const siteVisit = await prisma.siteVisit.findFirst({
      where: { id: req.params.id, tenantId },
      include: {
        lead: { select: { id: true, leadNumber: true, firstName: true, lastName: true, phone: true, company: true, email: true, status: true, owner: { select: { id: true, firstName: true, lastName: true, email: true, profile: { select: { name: true } } } } } },
        project: { select: { id: true, name: true } },
        assignee: { select: { id: true, firstName: true, lastName: true, email: true } },
        creator: { select: { id: true, firstName: true, lastName: true, email: true, profile: { select: { name: true } } } },
        completedBy: { select: { id: true, firstName: true, lastName: true, email: true, profile: { select: { name: true } } } },
        cancelledBy: { select: { id: true, firstName: true, lastName: true, email: true, profile: { select: { name: true } } } },
        previousSiteVisit: { select: { id: true, siteVisitNumber: true, status: true, scheduledAt: true } },
        activities: { take: 10, orderBy: { createdAt: 'desc' } },
        tasks: { take: 10, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!siteVisit) {
      return res.status(404).json({ success: false, error: 'Site visit not found' });
    }

    if (!(await canAccessSiteVisit(req.user!, siteVisit))) {
      return res.status(403).json({ success: false, error: 'You do not have access to this site visit' });
    }

    res.json({ success: true, data: siteVisit });
  } catch (error) {
    console.error('Get site visit error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch site visit' });
  }
});

router.post('/', authorize('SiteVisit', 'create'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId, id: userId } = req.user!;
    const data = siteVisitSchema.parse(req.body);

    const lead = await prisma.lead.findFirst({
      where: { id: data.leadId, tenantId },
      select: { id: true, tenantId: true, ownerId: true, creatorId: true, status: true },
    });
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }
    if (!(await canAccessLead(req.user!, lead))) {
      return res.status(403).json({ success: false, error: 'You do not have access to this lead' });
    }

    const siteVisitStatus = data.status || 'SCHEDULED';
    if (siteVisitStatus === 'COMPLETED') {
      return res.status(400).json({ success: false, error: 'Use the completion action to complete a site visit.' });
    }
    const result = await prisma.$transaction(async (tx) => {
      const siteVisitNumber = await getNextSiteVisitNumber(tx, tenantId);
      const siteVisit = await tx.siteVisit.create({
        data: {
          tenantId,
          leadId: data.leadId,
          projectId: data.projectId,
          assigneeId: data.assigneeId,
          creatorId: userId,
          queueId: data.queueId,
          siteVisitNumber,
          scheduledAt: new Date(data.scheduledAt),
          status: siteVisitStatus,
          notes: data.notes,
          feedback: data.feedback,
          rating: data.rating,
        },
        include: {
          lead: { select: { id: true, firstName: true, lastName: true } },
          project: { select: { id: true, name: true } },
        },
      });

      const profileName = req.user!.profileName || 'Admin';
      if (
        siteVisitStatus === 'SCHEDULED' &&
        lead.status === 'PROSPECT' &&
        canTransitionStatus(profileName, 'PROSPECT', 'SITE_VISIT_SCHEDULED')
      ) {
        await tx.lead.update({
          where: { id: lead.id },
          data: { status: 'SITE_VISIT_SCHEDULED' },
        });
        await tx.auditLog.create({
          data: {
            tenantId,
            userId,
            leadId: lead.id,
            action: 'SITE_VISIT_SCHEDULED',
            objectType: 'Lead',
            objectId: lead.id,
            oldValues: { status: 'PROSPECT' },
            newValues: { status: 'SITE_VISIT_SCHEDULED', siteVisitId: siteVisit.id, siteVisitNumber, reason: data.notes },
          },
        });
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'SITE_VISIT_CREATED',
          objectType: 'SiteVisit',
          objectId: siteVisit.id,
          newValues: { leadId: data.leadId, scheduledAt: data.scheduledAt, siteVisitNumber },
        },
      });
      return siteVisit;
    });

    res.status(201).json({ success: true, data: result });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: error.errors[0].message });
    }
    console.error('Create site visit error:', error);
    res.status(500).json({ success: false, error: 'Failed to create site visit' });
  }
});

router.put('/:id', authorize('SiteVisit', 'edit'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId, id: userId } = req.user!;

    const existing = await prisma.siteVisit.findFirst({
      where: { id: req.params.id, tenantId },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Site visit not found' });
    }
    if (!(await canAccessSiteVisit(req.user!, existing))) {
      return res.status(403).json({ success: false, error: 'You do not have access to this site visit' });
    }
    if (existing.status !== 'SCHEDULED') {
      return res.status(400).json({ success: false, error: 'Historical site visits cannot be edited' });
    }

    const data = updateSiteVisitSchema.parse(req.body);
    if (data.status === 'COMPLETED') {
      return res.status(400).json({ success: false, error: 'Use the completion action to complete a site visit.' });
    }

    const updateData: any = { ...data };
    if (data.scheduledAt) updateData.scheduledAt = new Date(data.scheduledAt);

    const siteVisit = await prisma.siteVisit.update({
      where: { id: req.params.id },
      data: updateData,
    });

    await auditLog(tenantId, userId, 'UPDATE', 'SiteVisit', siteVisit.id, existing, siteVisit);

    res.json({ success: true, data: siteVisit });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: error.errors[0].message });
    }
    console.error('Update site visit error:', error);
    res.status(500).json({ success: false, error: 'Failed to update site visit' });
  }
});

router.patch('/:id/complete', authorize('SiteVisit', 'edit'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId, id: userId } = req.user!;
    const parsed = completeSiteVisitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message || 'Completion details are required' });
    }
    const { completedAt, customerFeedback, completionNotes, latitude, longitude } = parsed.data;

    const existing = await prisma.siteVisit.findFirst({
      where: { id: req.params.id, tenantId },
      include: {
        lead: {
          select: {
            id: true,
            status: true,
            ownerId: true,
            source: true,
            leadSubSource: true,
            rating: true,
            owner: { select: { profile: { select: { name: true } } } },
          },
        },
        project: { select: { name: true, latitude: true, longitude: true } },
      },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Site visit not found' });
    }

    if (!(await canAccessSiteVisit(req.user!, existing))) {
      return res.status(403).json({ success: false, error: 'You do not have access to this site visit' });
    }

    if (existing.status !== 'SCHEDULED') {
      return res.status(400).json({ success: false, error: 'Only scheduled site visits can be completed' });
    }

    const locationCheck = checkSiteVisitLocation(
      existing.project?.name,
      existing.project?.latitude,
      existing.project?.longitude,
      latitude,
      longitude,
    );
    if (!locationCheck.allowed) {
      return res.status(400).json({ success: false, error: locationCheck.error });
    }

    const profileName = req.user!.profileName || 'Admin';
    if (
      existing.lead &&
      existing.lead.status === 'SITE_VISIT_SCHEDULED' &&
      !canTransitionStatus(profileName, 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_HAPPENED')
    ) {
      return res.status(403).json({ success: false, error: 'Not authorized to complete this site visit' });
    }

    const completedBy = await prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { firstName: true, lastName: true },
    });
    if (!completedBy) {
      return res.status(401).json({ success: false, error: 'Authenticated user is no longer available' });
    }
    const completedByName = `${completedBy.firstName} ${completedBy.lastName}`.trim();

    const result = await prisma.$transaction(async (tx) => {
      const siteVisit = await tx.siteVisit.update({
        where: { id: req.params.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(completedAt),
          completedById: userId,
          customerFeedback: customerFeedback.trim(),
          completionNotes: completionNotes.trim(),
          feedback: customerFeedback.trim(),
        },
        include: {
          completedBy: { select: { id: true, firstName: true, lastName: true } },
          project: { select: { id: true, name: true } },
        },
      });

      let leadStatus = existing.lead?.status || null;
      if (existing.lead && existing.lead.status === 'SITE_VISIT_SCHEDULED') {
        const lead = await tx.lead.update({
          where: { id: existing.leadId },
          data: { status: 'SITE_VISIT_HAPPENED' },
          select: { status: true },
        });
        leadStatus = lead.status;

        if (existing.lead.owner?.profile?.name === 'SVC') {
          const rrQueue = await findApplicableRRQueue(tenantId, {
            projectId: existing.projectId,
            status: lead.status,
            source: existing.lead.source,
            secondarySource: existing.lead.leadSubSource,
            priority: existing.lead.rating,
          }, tx);
          if (!rrQueue) {
            throw new Error('PROJECT_RR_QUEUE_NOT_FOUND');
          }
          const assignment = await RoundRobinAssignmentService.assignLeadInTransaction(
            tx,
            rrQueue.id,
            existing.leadId,
            tenantId,
          );
          const newOwner = await tx.user.findFirst({
            where: { id: assignment.assignedUserId, tenantId },
            select: { profile: { select: { name: true } } },
          });
          await createOwnerHistory({
            tenantId,
            leadId: existing.leadId,
            previousOwnerId: existing.lead.ownerId,
            newOwnerId: assignment.assignedUserId,
            previousProfile: 'SVC',
            newProfile: newOwner?.profile?.name || null,
            previousStatus: existing.lead.status,
            newStatus: lead.status,
            handoffReason: `Site Visit completed for project ${existing.projectId}`,
            changedById: userId,
          }, tx);
        }

        await tx.auditLog.create({
          data: {
            tenantId,
            userId,
            leadId: existing.leadId,
            action: 'SITE_VISIT_COMPLETED',
            objectType: 'Lead',
            objectId: existing.leadId,
            oldValues: { status: 'SITE_VISIT_SCHEDULED' },
            newValues: { status: 'SITE_VISIT_HAPPENED', siteVisitId: existing.id, completedAt, completedById: userId, completedByName, customerFeedback, completionNotes },
          },
        });
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          leadId: existing.leadId,
          action: 'SITE_VISIT_COMPLETED',
          objectType: 'SiteVisit',
          objectId: siteVisit.id,
          oldValues: { status: 'SCHEDULED' },
          newValues: { status: 'COMPLETED', completedAt, completedById: userId, completedByName, customerFeedback, completionNotes },
        },
      });

      return { siteVisit, leadStatus };
    });

    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof Error && error.message === 'PROJECT_RR_QUEUE_NOT_FOUND') {
      return res.status(409).json({ success: false, error: 'No Round Robin queue is configured for this project and lead source. The Site Visit remains scheduled.' });
    }
    console.error('Complete site visit error:', error);
    res.status(500).json({ success: false, error: 'Failed to complete site visit' });
  }
});

router.patch('/:id/cancel', authorize('SiteVisit', 'edit'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId, id: userId } = req.user!;
    const parsed = cancelSiteVisitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message || 'Reason is required' });
    }
    const reason = parsed.data.reason.trim();
    if (!reason) {
      return res.status(400).json({ success: false, error: 'Reason is required' });
    }

    const existing = await prisma.siteVisit.findFirst({
      where: { id: req.params.id, tenantId },
      include: { lead: { select: { id: true, status: true, ownerId: true } } },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Site visit not found' });
    }

    if (!(await canAccessSiteVisit(req.user!, existing))) {
      return res.status(403).json({ success: false, error: 'You do not have access to this site visit' });
    }

    if (existing.status !== 'SCHEDULED') {
      return res.status(400).json({ success: false, error: 'Only scheduled site visits can be cancelled' });
    }

    const profileName = req.user!.profileName || 'Admin';
    if (
      existing.lead &&
      existing.lead.status === 'SITE_VISIT_SCHEDULED' &&
      !canTransitionStatus(profileName, 'SITE_VISIT_SCHEDULED', 'PROSPECT')
    ) {
      return res.status(403).json({ success: false, error: 'Not authorized to cancel this site visit' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const siteVisit = await tx.siteVisit.update({
        where: { id: req.params.id },
        data: { status: 'CANCELLED', cancellationReason: reason, cancelledAt: new Date(), cancelledById: userId },
      });

      if (existing.lead && existing.lead.status === 'SITE_VISIT_SCHEDULED') {
        const otherScheduled = await tx.siteVisit.count({
          where: {
            tenantId,
            leadId: existing.leadId,
            status: 'SCHEDULED',
            id: { not: existing.id },
          },
        });
        if (otherScheduled === 0) {
          await tx.lead.update({
            where: { id: existing.leadId },
            data: { status: 'PROSPECT' },
          });

          await tx.auditLog.create({
            data: {
              tenantId,
              userId,
              leadId: existing.leadId,
              action: 'SITE_VISIT_CANCELLED',
              objectType: 'Lead',
              objectId: existing.leadId,
              oldValues: { status: 'SITE_VISIT_SCHEDULED' },
              newValues: { status: 'PROSPECT', siteVisitId: existing.id, reason },
            },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          leadId: existing.leadId,
          action: 'SITE_VISIT_CANCELLED',
          objectType: 'SiteVisit',
          objectId: siteVisit.id,
          oldValues: { status: 'SCHEDULED' },
          newValues: { status: 'CANCELLED', cancellationReason: reason, cancelledById: userId, cancelledAt: new Date().toISOString() },
        },
      });

      return siteVisit;
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Cancel site visit error:', error);
    res.status(500).json({ success: false, error: 'Failed to cancel site visit' });
  }
});

router.post('/:id/revisit', authorize('SiteVisit', 'create'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId, id: userId } = req.user!;
    const parsed = revisitSiteVisitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message || 'Revisit requires reason, scheduled date, and project' });
    }
    const reason = parsed.data.reason.trim();
    if (!reason) {
      return res.status(400).json({ success: false, error: 'Reason is required' });
    }

    const existing = await prisma.siteVisit.findFirst({
      where: { id: req.params.id, tenantId },
      include: {
        lead: {
          select: {
            id: true,
            status: true,
            ownerId: true,
            source: true,
            leadSubSource: true,
            rating: true,
          },
        },
        project: { select: { id: true } },
      },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Site visit not found' });
    }
    if (!['SCHEDULED', 'COMPLETED', 'CANCELLED'].includes(existing.status)) {
      return res.status(400).json({ success: false, error: 'Invalid site visit status' });
    }

    if (!(await canAccessSiteVisit(req.user!, existing))) {
      return res.status(403).json({ success: false, error: 'You do not have access to this site visit' });
    }

    const revisitNotes = parsed.data.notes?.trim()
      ? `${parsed.data.notes.trim()} (Revisit reason: ${reason})`
      : `Revisit reason: ${reason}`;

    const result = await prisma.$transaction(async (tx) => {
      const project = await tx.project.findFirst({
        where: { id: parsed.data.projectId, tenantId, isActive: true },
        select: { id: true },
      });
      if (!project) throw new Error('PROJECT_NOT_AVAILABLE');

      const sameProject = existing.projectId === parsed.data.projectId;
      let rrQueue: Awaited<ReturnType<typeof findApplicableRRQueue>> = null;
      if (!sameProject) {
        rrQueue = await findApplicableRRQueue(tenantId, {
          projectId: parsed.data.projectId,
          status: existing.lead?.status,
          source: existing.lead?.source,
          secondarySource: existing.lead?.leadSubSource,
          priority: existing.lead?.rating,
        }, tx);
        if (!rrQueue) throw new Error('PROJECT_RR_QUEUE_NOT_FOUND');
      }

      const siteVisitNumber = await getNextSiteVisitNumber(tx, tenantId);
      const queueId = sameProject ? existing.queueId : rrQueue?.id ?? null;
      const siteVisit = await tx.siteVisit.create({
        data: {
          tenantId,
          leadId: existing.leadId,
          projectId: parsed.data.projectId,
          assigneeId: sameProject ? existing.assigneeId : null,
          creatorId: userId,
          queueId,
          siteVisitNumber,
          previousSiteVisitId: existing.id,
          scheduledAt: new Date(parsed.data.scheduledAt),
          status: 'SCHEDULED',
          notes: revisitNotes,
          visitType: sameProject ? 'REVISIT' : undefined,
        },
        include: {
          lead: { select: { id: true, firstName: true, lastName: true } },
          project: { select: { id: true, name: true } },
          previousSiteVisit: { select: { id: true, status: true, scheduledAt: true, siteVisitNumber: true } },
        },
      });

      if (!sameProject && rrQueue) {
        try {
          await RoundRobinAssignmentService.assignSiteVisitInTransaction(
            tx,
            rrQueue.id,
            siteVisit.id,
            existing.leadId,
            tenantId,
          );
        } catch (error) {
          if (error instanceof Error && error.message === 'NO_ELIGIBLE_USER') {
            throw new Error('PROJECT_RR_QUEUE_HAS_NO_ACTIVE_MEMBERS');
          }
          throw error;
        }
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          leadId: existing.leadId,
          action: 'SITE_VISIT_REVISIT_CREATED',
          objectType: 'SiteVisit',
          objectId: siteVisit.id,
          oldValues: { previousSiteVisitId: existing.id, previousSiteVisitNumber: (existing as any).siteVisitNumber },
          newValues: {
            siteVisitNumber,
            reason,
            scheduledAt: parsed.data.scheduledAt,
            leadId: existing.leadId,
            projectId: parsed.data.projectId,
            assignedToProjectRoundRobin: !sameProject,
          },
        },
      });

      return tx.siteVisit.findUniqueOrThrow({
        where: { id: siteVisit.id },
        include: {
          lead: { select: { id: true, firstName: true, lastName: true } },
          project: { select: { id: true, name: true } },
          assignee: { select: { id: true, firstName: true, lastName: true } },
          previousSiteVisit: { select: { id: true, status: true, scheduledAt: true, siteVisitNumber: true } },
        },
      });
    });

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    if (error instanceof Error && error.message === 'PROJECT_NOT_AVAILABLE') {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }
    if (error instanceof Error && error.message === 'PROJECT_RR_QUEUE_NOT_FOUND') {
      return res.status(409).json({ success: false, error: 'No Round Robin queue is configured for the selected project and lead source.' });
    }
    if (error instanceof Error && error.message === 'PROJECT_RR_QUEUE_HAS_NO_ACTIVE_MEMBERS') {
      return res.status(409).json({ success: false, error: 'The selected project Round Robin queue has no active Sales members.' });
    }
    console.error('Revisit site visit error:', error);
    res.status(500).json({ success: false, error: 'Failed to create revisit site visit' });
  }
});

router.delete('/:id', authorize('SiteVisit', 'delete'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId, id: userId } = req.user!;

    const existing = await prisma.siteVisit.findFirst({
      where: { id: req.params.id, tenantId },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Site visit not found' });
    }

    if (!(await canAccessSiteVisit(req.user!, existing))) {
      return res.status(403).json({ success: false, error: 'You do not have access to this site visit' });
    }

    await prisma.siteVisit.delete({ where: { id: req.params.id } });

    await auditLog(tenantId, userId, 'DELETE', 'SiteVisit', existing.id, existing, null);

    res.json({ success: true, data: null });
  } catch (error) {
    console.error('Delete site visit error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete site visit' });
  }
});

export default router;