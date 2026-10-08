import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '@dct-crm/db';
import { activitySchema } from '@dct-crm/shared';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/authorization';
import {
  applyScope,
  canAccessActivity,
  canAccessLeadId,
  getScopeClause,
} from '../services/recordAccess';
import { promoteNewLeadOnFirstActivity } from '../services/leadWorkflowExtras';

const router = Router();

router.use(authenticate);

const calendarActivityTypes = ['TASK', 'SITE_VISIT', 'FOLLOW_UP', 'SCHEDULE', 'MEMO', 'MEETING'] as const;
const activityStatuses = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
const activityPriorities = ['LOW', 'MEDIUM', 'HIGH'] as const;

export function calendarActivityVisibilityFilter(user: {
  id: string;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
}): Prisma.ActivityWhereInput {
  if (user.isAdmin || user.isSuperAdmin) return {};
  return { OR: [{ userId: user.id }, { assignedToId: user.id }] };
}

function normalizeActivityInput(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const input = body as Record<string, unknown>;
  const firstDefined = (...keys: string[]) => {
    const key = keys.find((candidate) => input[candidate] !== undefined);
    return key ? input[key] : undefined;
  };
  return {
    ...input,
    type: firstDefined('type', 'activityType', 'activity_type'),
    subject: firstDefined('subject', 'title'),
    startAt: firstDefined('startAt', 'start', 'start_datetime'),
    endAt: firstDefined('endAt', 'end', 'end_datetime'),
    leadId: firstDefined('leadId', 'lead_id'),
    customerId: firstDefined('customerId', 'customer_id'),
    opportunityId: firstDefined('opportunityId', 'opportunity_id'),
    siteVisitId: firstDefined('siteVisitId', 'site_visit_id'),
    bookingId: firstDefined('bookingId', 'booking_id'),
    assignedToId: firstDefined('assignedToId', 'assigned_to'),
    reminderAt: firstDefined('reminderAt', 'reminder'),
  };
}

type CalendarActivityRecord = Prisma.ActivityGetPayload<{
  include: {
    user: { select: { firstName: true; lastName: true } };
    assignedTo: { select: { firstName: true; lastName: true } };
    lead: { select: { id: true; firstName: true; lastName: true; company: true } };
    opportunity: { select: { id: true; name: true } };
  };
}>;

function calendarActivity(activity: CalendarActivityRecord) {
  const assignedTo = activity.assignedTo
    ? `${activity.assignedTo.firstName} ${activity.assignedTo.lastName}`.trim()
    : null;
  const start = activity.startAt;
  const end = activity.endAt || (start ? new Date(new Date(start).getTime() + 60 * 60 * 1000) : null);
  return {
    ...activity,
    activityType: activity.type,
    title: activity.subject,
    start,
    end,
    assignedTo,
    customerId: activity.leadId,
    createdById: activity.userId,
    createdBy: activity.user
      ? `${activity.user.firstName} ${activity.user.lastName}`.trim()
      : null,
    reminder: activity.reminderAt,
  };
}

async function validateCalendarReferences(
  req: AuthRequest,
  data: {
    assignedToId?: string | null;
    leadId?: string | null;
    customerId?: string | null;
    siteVisitId?: string | null;
    opportunityId?: string | null;
    bookingId?: string | null;
  },
  res: Response,
) {
  if (data.assignedToId) {
    const assignee = await prisma.user.findFirst({
      where: { id: data.assignedToId, tenantId: req.tenantId!, isActive: true },
      select: { id: true },
    });
    if (!assignee) {
      res.status(400).json({ success: false, error: 'Assigned user must be an active user in this company' });
      return false;
    }
  }

  const relatedLeadId = data.leadId ?? data.customerId;
  if (relatedLeadId && !(await canAccessLeadId(req.user!, relatedLeadId))) {
    res.status(403).json({ success: false, error: 'You do not have access to the linked lead or customer' });
    return false;
  }

  if (data.siteVisitId) {
    const siteVisit = await prisma.siteVisit.findFirst({
      where: applyScope(
        { id: data.siteVisitId, tenantId: req.tenantId! },
        await getScopeClause(req.user!, 'siteVisit'),
      ),
      select: { id: true },
    });
    if (!siteVisit) {
      res.status(403).json({ success: false, error: 'You do not have access to the linked site visit' });
      return false;
    }
  }

  if (data.opportunityId) {
    const opportunityWhere = applyScope(
      { id: data.opportunityId, tenantId: req.tenantId! },
      await getScopeClause(req.user!, 'opportunity'),
    );
    const opportunity = await prisma.opportunity.findFirst({
      where: opportunityWhere,
      select: { id: true },
    });
    if (!opportunity) {
      res.status(400).json({ success: false, error: 'Related opportunity was not found or is not accessible' });
      return false;
    }
  }

  if (data.bookingId) {
    const booking = await prisma.booking.findFirst({
      where: applyScope(
        { id: data.bookingId, tenantId: req.tenantId! },
        await getScopeClause(req.user!, 'booking'),
      ),
      select: { id: true },
    });
    if (!booking) {
      res.status(403).json({ success: false, error: 'You do not have access to the linked booking' });
      return false;
    }
  }

  return true;
}

router.get('/', authorize('Activity', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const { page = 1, limit = 20, type, activity_type: activityType, leadId, customerId, customer_id: customerIdSnake, siteVisitId, opportunityId, bookingId, userId, assigned_to: assignedToId, startDate, endDate, start, end, status, priority, search, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    const isCalendarQuery = start !== undefined || end !== undefined;
    const skip = (Number(page) - 1) * Number(limit);

    let where: any = { tenantId: req.tenantId! };
    const requestedType = activityType || type;
    const types = requestedType ? String(requestedType).split(',').filter(Boolean) : [];
    if (types.length === 1) where.type = types[0];
    else if (types.length > 1) where.type = { in: types };
    if (leadId || customerId || customerIdSnake) where.leadId = leadId || customerId || customerIdSnake;
    if (siteVisitId) where.siteVisitId = siteVisitId;
    if (opportunityId) where.opportunityId = opportunityId;
    if (bookingId) where.bookingId = bookingId;
    if (userId) where.userId = userId;
    if (assignedToId) where.assignedToId = assignedToId;
    if (isCalendarQuery) {
      if (typeof start !== 'string' || typeof end !== 'string') {
        return res.status(400).json({ success: false, error: 'Both start and end dates are required' });
      }
      const rangeStart = new Date(start);
      const rangeEnd = new Date(end);
      if (!Number.isFinite(rangeStart.getTime()) || !Number.isFinite(rangeEnd.getTime()) || rangeStart > rangeEnd) {
        return res.status(400).json({ success: false, error: 'Invalid calendar date range' });
      }
      if (rangeEnd.getTime() - rangeStart.getTime() > 367 * 24 * 60 * 60 * 1000) {
        return res.status(400).json({ success: false, error: 'Calendar date range cannot exceed one year' });
      }
      where.startAt = { not: null, lte: rangeEnd };
      where.AND = [
        {
          OR: [
            { endAt: { gte: rangeStart } },
            { endAt: null, startAt: { gte: rangeStart } },
          ],
        },
      ];
    } else if (startDate && endDate) {
      where.createdAt = {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string),
      };
    }
    const statuses = status ? String(status).split(',').filter(Boolean) : [];
    if (statuses.length) {
      if (statuses.some((value) => !(activityStatuses as readonly string[]).includes(value))) {
        return res.status(400).json({ success: false, error: 'Invalid activity status' });
      }
      where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
    }
    const priorities = priority ? String(priority).split(',').filter(Boolean) : [];
    if (priorities.length) {
      if (priorities.some((value) => !(activityPriorities as readonly string[]).includes(value))) {
        return res.status(400).json({ success: false, error: 'Invalid activity priority' });
      }
      where.priority = priorities.length === 1 ? priorities[0] : { in: priorities };
    }
    if (activityType && types.some((value) => !(calendarActivityTypes as readonly string[]).includes(value))) {
      return res.status(400).json({ success: false, error: 'Invalid calendar activity type' });
    }
    if (search) {
      where.OR = [
        { subject: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
        { notes: { contains: search as string, mode: 'insensitive' } },
      ];
    }
    if (isCalendarQuery) {
      where.AND = [...(where.AND || []), calendarActivityVisibilityFilter(req.user!)];
    } else {
      where = applyScope(where, await getScopeClause(req.user!, 'activity'));
    }

    const [activities, total] = await Promise.all([
      prisma.activity.findMany({
        where,
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
          lead: { select: { id: true, firstName: true, lastName: true, phone: true, company: true } },
          siteVisit: { select: { id: true, scheduledAt: true, status: true } },
          opportunity: { select: { id: true, name: true, stage: true } },
          booking: { select: { id: true, number: true, status: true } },
        },
        ...(isCalendarQuery ? {} : { skip, take: Math.min(Number(limit), 100) }),
        orderBy: isCalendarQuery ? { startAt: 'asc' } : { [sortBy as string]: sortOrder },
      }),
      isCalendarQuery ? Promise.resolve(0) : prisma.activity.count({ where }),
    ]);

    if (isCalendarQuery) {
      return res.json({ success: true, data: activities.map(calendarActivity) });
    }

    res.json({
      success: true,
      data: activities,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get activities error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch activities' });
  }
});

router.get('/summary', authorize('Activity', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const where = {
      tenantId: req.tenantId!,
      startAt: { not: null },
      ...calendarActivityVisibilityFilter(req.user!),
    };
    const now = new Date();
    const todayStart = typeof req.query.todayStart === 'string' ? new Date(req.query.todayStart) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = typeof req.query.todayEnd === 'string' ? new Date(req.query.todayEnd) : new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    if (!Number.isFinite(todayStart.getTime()) || !Number.isFinite(todayEnd.getTime()) || todayStart >= todayEnd) {
      return res.status(400).json({ success: false, error: 'Invalid today date range' });
    }
    const [total, today, upcoming, completed, siteVisits, meetings] = await Promise.all([
      prisma.activity.count({ where }),
      prisma.activity.count({ where: { ...where, startAt: { gte: todayStart, lt: todayEnd } } }),
      prisma.activity.count({ where: { ...where, startAt: { gte: now }, status: { in: ['PLANNED', 'IN_PROGRESS'] } } }),
      prisma.activity.count({ where: { ...where, status: 'COMPLETED' } }),
      prisma.activity.count({ where: { ...where, type: 'SITE_VISIT' } }),
      prisma.activity.count({ where: { ...where, type: 'MEETING' } }),
    ]);
    res.json({ success: true, data: { total, today, upcoming, completed, siteVisits, meetings } });
  } catch (error) {
    console.error('Get activity calendar summary error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch activity calendar summary' });
  }
});

router.get('/options', authorize('Activity', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const [users, leads, opportunities] = await Promise.all([
      prisma.user.findMany({
        where: { tenantId: req.tenantId!, isActive: true },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
      prisma.lead.findMany({
        where: applyScope({ tenantId: req.tenantId! }, await getScopeClause(req.user!, 'lead')),
        select: { id: true, firstName: true, lastName: true, company: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        take: 200,
      }),
      prisma.opportunity.findMany({
        where: applyScope({ tenantId: req.tenantId! }, await getScopeClause(req.user!, 'opportunity')),
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
        take: 200,
      }),
    ]);
    res.json({ success: true, data: { users, leads, opportunities } });
  } catch (error) {
    console.error('Get activity calendar options error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch activity calendar options' });
  }
});

router.get('/:id', authorize('Activity', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const activity = await prisma.activity.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId! },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        lead: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
        siteVisit: { select: { id: true, scheduledAt: true, status: true, notes: true } },
        opportunity: { select: { id: true, name: true, stage: true, amount: true } },
        booking: { select: { id: true, number: true, status: true, totalAmount: true } },
      },
    });

    if (!activity) {
      return res.status(404).json({ success: false, error: 'Activity not found' });
    }

    if (!(await canAccessActivity(req.user!, activity))) {
      return res.status(403).json({ success: false, error: 'You do not have access to this activity' });
    }

    res.json({ success: true, data: activity });
  } catch (error) {
    console.error('Get activity error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch activity' });
  }
});

router.post('/', authorize('Activity', 'create'), async (req: AuthRequest, res: Response) => {
  try {
    const data = activitySchema.parse(normalizeActivityInput(req.body));

    if (data.leadId !== undefined && data.customerId !== undefined && data.leadId !== data.customerId) {
      return res.status(400).json({ success: false, error: 'Lead and customer references must match' });
    }
    const relatedLeadId = data.leadId !== undefined ? data.leadId : data.customerId;
    const validatedData = { ...data, leadId: relatedLeadId };

    if ((data.startAt == null) !== (data.endAt == null)) {
      return res.status(400).json({ success: false, error: 'Both start and end date/time are required for calendar activities' });
    }
    if (data.startAt && data.endAt && new Date(data.endAt) <= new Date(data.startAt)) {
      return res.status(400).json({ success: false, error: 'End date and time must be after the start date and time' });
    }
    if (!(await validateCalendarReferences(req, validatedData, res))) return;
    if ((data.type === 'NOTE' && !data.description?.trim()) || (data.type === 'MEMO' && !data.description?.trim() && !data.notes?.trim())) {
      return res.status(400).json({ success: false, error: 'Note content is required' });
    }

    const activity = await prisma.$transaction(async (tx) => {
      const created = await tx.activity.create({
        data: {
          tenantId: req.tenantId!,
          userId: req.user!.id,
          type: data.type,
          subject: data.subject,
          description: data.description,
          dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
          leadId: relatedLeadId || undefined,
          siteVisitId: data.siteVisitId || undefined,
          opportunityId: data.opportunityId || undefined,
          bookingId: data.bookingId || undefined,
          assignedToId: data.assignedToId || undefined,
          startAt: data.startAt ? new Date(data.startAt) : undefined,
          endAt: data.endAt ? new Date(data.endAt) : undefined,
          status: data.status || 'PLANNED',
          priority: data.priority || 'MEDIUM',
          location: data.location || undefined,
          meetingUrl: data.meetingUrl || undefined,
          reminderAt: data.reminderAt ? new Date(data.reminderAt) : undefined,
          notes: data.notes || undefined,
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
          lead: { select: { id: true, firstName: true, lastName: true, company: true } },
          opportunity: { select: { id: true, name: true } },
        },
      });

      if (relatedLeadId) {
        await promoteNewLeadOnFirstActivity(tx, {
          tenantId: req.tenantId!,
          leadId: relatedLeadId,
          userId: req.user!.id,
          profileName: req.user!.profileName,
          activityLabel: data.type === 'NOTE' ? 'Note' : `Activity (${data.type})`,
        });
      }

      await tx.auditLog.create({
        data: {
          tenantId: req.tenantId!,
          userId: req.user!.id,
          leadId: relatedLeadId || undefined,
          action: data.type === 'NOTE' ? 'NOTE_CREATED' : 'CREATE',
          objectType: 'Activity',
          objectId: created.id,
          newValues: data,
        },
      });

      return created;
    });

    res.status(201).json({ success: true, data: calendarActivity(activity) });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: error.errors[0].message });
    }
    console.error('Create activity error:', error);
    res.status(500).json({ success: false, error: 'Failed to create activity' });
  }
});

router.put('/:id', authorize('Activity', 'edit'), async (req: AuthRequest, res: Response) => {
  try {
    const existingActivity = await prisma.activity.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId! },
    });

    if (!existingActivity) {
      return res.status(404).json({ success: false, error: 'Activity not found' });
    }

    if (!(await canAccessActivity(req.user!, existingActivity))) {
      return res.status(403).json({ success: false, error: 'You do not have access to this activity' });
    }

    const data = activitySchema.partial().parse(normalizeActivityInput(req.body));

    if (data.leadId !== undefined && data.customerId !== undefined && data.leadId !== data.customerId) {
      return res.status(400).json({ success: false, error: 'Lead and customer references must match' });
    }
    const relatedLeadId = data.leadId !== undefined ? data.leadId : data.customerId;
    const validatedData = { ...data, ...(relatedLeadId !== undefined ? { leadId: relatedLeadId } : {}) };

    const effectiveStartAt = data.startAt === undefined ? existingActivity.startAt : data.startAt ? new Date(data.startAt) : null;
    const effectiveEndAt = data.endAt === undefined ? existingActivity.endAt : data.endAt ? new Date(data.endAt) : null;
    if ((effectiveStartAt == null) !== (effectiveEndAt == null)) {
      return res.status(400).json({ success: false, error: 'Both start and end date/time are required for calendar activities' });
    }
    if (effectiveStartAt && effectiveEndAt && effectiveEndAt <= effectiveStartAt) {
      return res.status(400).json({ success: false, error: 'End date and time must be after the start date and time' });
    }
    if (!(await validateCalendarReferences(req, validatedData, res))) return;

    const updateData: Record<string, unknown> = {};
    for (const field of ['type', 'subject', 'description', 'leadId', 'siteVisitId', 'opportunityId', 'bookingId', 'assignedToId', 'status', 'priority', 'location', 'meetingUrl', 'notes'] as const) {
      if (data[field] !== undefined) updateData[field] = data[field] || null;
    }
    if (relatedLeadId !== undefined) updateData.leadId = relatedLeadId;
    if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
    if (data.startAt !== undefined) updateData.startAt = data.startAt ? new Date(data.startAt) : null;
    if (data.endAt !== undefined) updateData.endAt = data.endAt ? new Date(data.endAt) : null;
    if (data.reminderAt !== undefined) updateData.reminderAt = data.reminderAt ? new Date(data.reminderAt) : null;
    if (data.status === 'COMPLETED') updateData.completedAt = existingActivity.completedAt || new Date();
    else if (data.status && existingActivity.status === 'COMPLETED') updateData.completedAt = null;

    const activity = await prisma.activity.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        lead: { select: { id: true, firstName: true, lastName: true, company: true } },
        opportunity: { select: { id: true, name: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: req.tenantId!,
        userId: req.user!.id,
        leadId: existingActivity.leadId || undefined,
        action: 'UPDATE',
        objectType: 'Activity',
        objectId: activity.id,
        oldValues: existingActivity,
        newValues: data,
      },
    });

    res.json({ success: true, data: calendarActivity(activity) });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: error.errors[0].message });
    }
    console.error('Update activity error:', error);
    res.status(500).json({ success: false, error: 'Failed to update activity' });
  }
});

router.delete('/:id', authorize('Activity', 'delete'), async (req: AuthRequest, res: Response) => {
  try {
    const activity = await prisma.activity.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId! },
    });

    if (!activity) {
      return res.status(404).json({ success: false, error: 'Activity not found' });
    }

    if (!(await canAccessActivity(req.user!, activity))) {
      return res.status(403).json({ success: false, error: 'You do not have access to this activity' });
    }

    await prisma.activity.delete({ where: { id: req.params.id } });

    await prisma.auditLog.create({
      data: {
        tenantId: req.tenantId!,
        userId: req.user!.id,
        leadId: activity.leadId || undefined,
        action: 'DELETE',
        objectType: 'Activity',
        objectId: req.params.id,
        oldValues: activity,
      },
    });

    res.json({ success: true, message: 'Activity deleted successfully' });
  } catch (error) {
    console.error('Delete activity error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete activity' });
  }
});

router.put('/:id/complete', authorize('Activity', 'edit'), async (req: AuthRequest, res: Response) => {
  try {
    const activity = await prisma.activity.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId! },
    });

    if (!activity) {
      return res.status(404).json({ success: false, error: 'Activity not found' });
    }

    if (!(await canAccessActivity(req.user!, activity))) {
      return res.status(403).json({ success: false, error: 'You do not have access to this activity' });
    }

    const updatedActivity = await prisma.activity.update({
      where: { id: req.params.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: req.tenantId!,
        userId: req.user!.id,
        leadId: activity.leadId || undefined,
        action: 'STATUS_CHANGE',
        objectType: 'Activity',
        objectId: activity.id,
        oldValues: { completedAt: activity.completedAt },
        newValues: { completedAt: new Date() },
      },
    });

    res.json({ success: true, data: updatedActivity });
  } catch (error) {
    console.error('Complete activity error:', error);
    res.status(500).json({ success: false, error: 'Failed to complete activity' });
  }
});

export { router as activityRoutes };