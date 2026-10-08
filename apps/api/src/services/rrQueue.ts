import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@dct-crm/db';

export type RRClient = Prisma.TransactionClient | PrismaClient;

function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeText(item))
      .filter((item): item is string => item !== null);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => normalizeText(item))
      .filter((item): item is string => item !== null);
  }
  return [];
}

function matchesValue(value: string | null, list: string[]): boolean {
  if (!value) return false;
  const normalized = value.trim();
  return list.some((entry) => entry.trim().toLowerCase() === normalized.toLowerCase());
}

function isNoSourceQueue(queue: Record<string, any>): boolean {
  const configured = normalizeList(queue?.leadSource ?? queue?.sources ?? queue?.source ?? queue?.leadSources);
  return configured.some((entry) => entry.toLowerCase() === 'no source' || entry.toLowerCase() === 'nosource');
}

function projectMatchesLead(queue: Record<string, any>, projectId: string | null | undefined, projectName: string | null): boolean {
  const queueProjects = normalizeList(queue?.projectInterested ?? queue?.projects ?? queue?.project ?? queue?.projectName);
  if (queueProjects.length === 0) return true;
  if (queueProjects.some((entry) => entry.toLowerCase() === 'all' || entry.toLowerCase() === '*' || entry.toLowerCase() === 'all projects')) {
    return true;
  }
  if (!projectId && !projectName) return false;
  return queueProjects.some((entry) => {
    const normalized = entry.toLowerCase();
    return normalized === (projectId || '').toLowerCase() || normalized === (projectName || '').toLowerCase();
  });
}

export function calculateQueueMatchScore(queue: Record<string, any>, lead: Record<string, any>): number {
  const queueStatus = normalizeList(queue?.leadStatus ?? queue?.statuses ?? queue?.status);
  const queuePriority = normalizeList(queue?.leadPriority ?? queue?.priority ?? queue?.priorities);
  const queueSources = normalizeList(queue?.leadSource ?? queue?.sources ?? queue?.source ?? queue?.leadSources);
  const queueSecondary = normalizeList(queue?.secondarySource ?? queue?.secondarySources ?? queue?.secondarySourceList);
  const queueTertiary = normalizeList(queue?.tertiarySource ?? queue?.tertiarySources ?? queue?.tertiarySourceList);
  const queueProjects = normalizeList(queue?.projectInterested ?? queue?.projects ?? queue?.project ?? queue?.projectInterestedList);
  const queueExcludedNoSource = normalizeList(queue?.excludeFromNoSource ?? queue?.excludedSources ?? queue?.excludeFromNoSourceList);

  const leadStatus = normalizeText(lead?.status) ?? '';
  const leadPriority = normalizeText(lead?.priority ?? lead?.rating ?? lead?.leadPriority) ?? '';
  const leadSource = normalizeText(lead?.source ?? lead?.leadSource ?? lead?.lastSourceOfEnquiry) ?? '';
  const leadSecondary = normalizeText(lead?.secondarySource ?? lead?.lastSubSource ?? lead?.secondary) ?? '';
  const leadTertiary = normalizeText(lead?.tertiarySource ?? lead?.lastTertiarySource ?? lead?.tertiary) ?? '';
  const projectId = normalizeText(lead?.projectId);
  const projectName = normalizeText(lead?.project?.name ?? lead?.projectName);

  let score = 0;

  if (queueStatus.length > 0) {
    if (matchesValue(leadStatus, queueStatus)) score += 1_000_000;
    else score -= 1_000_000;
  }

  if (queuePriority.length > 0) {
    if (matchesValue(leadPriority, queuePriority)) score += 100_000;
    else score -= 100_000;
  }

  if (queueSources.length > 0) {
    const sourceMatches = matchesValue(leadSource, queueSources);
    const noSourceFallbackAllowed = isNoSourceQueue(queue) && !!leadSource && !sourceMatches && !matchesValue(leadSource, queueExcludedNoSource);
    if (sourceMatches || noSourceFallbackAllowed) score += 10_000;
    else score -= 10_000;
  }

  if (queueSecondary.length > 0) {
    if (!leadSecondary) score -= 1_000;
    else if (matchesValue(leadSecondary, queueSecondary)) score += 1_000;
    else score -= 1_000;
  }

  if (queueTertiary.length > 0) {
    if (!leadTertiary) score -= 100;
    else if (matchesValue(leadTertiary, queueTertiary)) score += 100;
    else score -= 100;
  }

  if (queueProjects.length > 0) {
    if (projectMatchesLead(queue, projectId, projectName)) score += 10;
    else score -= 10_000;
  } else {
    score += 0.5;
  }

  return score;
}

export function isLeadEligibleForAutoAssignment(lead: Record<string, any> | null | undefined, options: { isNewLead?: boolean; force?: boolean } = {}) {
  if (!lead) return false;
  if (options.force) return true;

  const leadQueueing = lead.leadQueueing === true || lead.lead_Queueing === true || lead.leadQueueing === 'true' || options.isNewLead === true;
  const leadAssigned = lead.leadAssigned === false || lead.lead_Assigned === false || lead.leadAssigned === 'false' || lead.leadReassign === true || lead.lead_Reassign === true;
  const projectPresent = !!(lead.projectId || lead.projectName || lead.project?.name);
  const sourcePresent = !!(lead.lastSourceOfEnquiry || lead.leadSource || lead.source || lead.last_Source_Of_Enquiry);
  const notDuplicate = String(lead.status || '').toUpperCase() !== 'DUPLICATE';

  return Boolean(leadQueueing && leadAssigned && projectPresent && sourcePresent && notDuplicate);
}

export function hasLeadAssignmentRelevantChanges(updateData: Record<string, unknown>): boolean {
  return ['status', 'ownerId', 'projectId', 'source'].some((field) =>
    Object.prototype.hasOwnProperty.call(updateData, field),
  );
}

export function getLeadSourceHierarchy(lead: Record<string, any> | null | undefined): string | null {
  if (!lead) return null;
  return (
    normalizeText(lead.lastSourceOfEnquiry ?? lead.last_Source_Of_Enquiry)
    ?? normalizeText(lead.leadSource ?? lead.source)
    ?? null
  );
}

export function getSecondarySourceHierarchy(lead: Record<string, any> | null | undefined): string | null {
  if (!lead) return null;
  return normalizeText(lead.lastSubSource ?? lead.last_Sub_Source ?? lead.secondarySource ?? lead.secondary) ?? null;
}

export function getTertiarySourceHierarchy(lead: Record<string, any> | null | undefined): string | null {
  if (!lead) return null;
  return normalizeText(lead.lastTertiarySource ?? lead.last_Tertiary_Source ?? lead.tertiarySource ?? lead.tertiary) ?? null;
}

export function selectNextSequenceMember<T extends { sequenceId: number }>(members: T[], previousId: number): T | null {
  const ordered = [...members].sort((left, right) => left.sequenceId - right.sequenceId);
  return ordered.find((member) => member.sequenceId > previousId) || ordered[0] || null;
}

export function getReusableSiteVisitOwner(
  existingLeadId: string | null,
  previousVisit: { projectId: string | null; assigneeId: string | null } | null,
  selectedProjectId: string,
): string | null {
  if (!isSiteVisitRevisit(existingLeadId, previousVisit, selectedProjectId)) return null;
  return previousVisit?.assigneeId ?? null;
}

export function isSiteVisitRevisit(
  existingLeadId: string | null,
  previousVisit: { projectId: string | null } | null,
  selectedProjectId: string,
): boolean {
  return Boolean(existingLeadId && previousVisit && previousVisit.projectId === selectedProjectId);
}

export function isNewProjectSiteVisit(
  existingLeadId: string | null,
  latestVisit: { projectId: string | null } | null,
  selectedProjectId: string,
): boolean {
  return Boolean(existingLeadId && latestVisit && latestVisit.projectId !== selectedProjectId);
}

export class RoundRobinAssignmentService {
  static async getActiveMembers(queueId: string, tenantId: string, tx: RRClient = prisma) {
    return tx.rRQueueMember.findMany({
      where: { rrQueueId: queueId, tenantId, activeMember: true, user: { isActive: true } },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true, isActive: true } } },
      orderBy: { sequenceId: 'asc' },
    });
  }

  static async getQueueState(queueId: string, tenantId: string, tx: RRClient = prisma) {
    const queue = await tx.rRQueue.findFirst({
      where: { id: queueId, tenantId },
      include: { members: { include: { user: { select: { id: true, firstName: true, lastName: true, email: true, isActive: true } } }, orderBy: { sequenceId: 'asc' } } },
    });
    if (!queue) return null;
    const activeMembers = queue.members.filter((member) => member.activeMember && member.user.isActive);
    return { ...queue, noOfUsers: activeMembers.length, activeMembers };
  }

  static async getNextMember(queueId: string, tenantId: string, tx: RRClient = prisma) {
    const state = await this.getQueueState(queueId, tenantId, tx);
    if (!state || state.activeMembers.length === 0) return null;
    return selectNextSequenceMember(state.activeMembers, state.previousId);
  }

  static async getNextEligibleMember(queueId: string, tenantId: string, tx: RRClient = prisma) {
    const queue = await tx.rRQueue.findFirst({
      where: { id: queueId, tenantId },
      include: { members: { include: { user: { select: { id: true, firstName: true, lastName: true, email: true, isActive: true } } }, orderBy: { sequenceId: 'asc' } } },
    });
    if (!queue) throw new Error('RR_QUEUE_NOT_FOUND');

    const members = [...queue.members].sort((a, b) => a.sequenceId - b.sequenceId);
    if (members.length === 0) return { member: null, skipped: ['No queue members configured'], fallbackOwnerId: queue.defaultOwnerId || queue.ownerId || null };

    const maxAttempts = Math.max(2, members.length * 2);
    const skipped: string[] = [];
    const startIndex = members.findIndex((member) => member.sequenceId > queue.previousId) >= 0
      ? members.findIndex((member) => member.sequenceId > queue.previousId)
      : 0;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const candidate = members[(startIndex + attempt) % members.length];
      if (!candidate) continue;
      if (!candidate.activeMember) {
        skipped.push(`${candidate.name}: member inactive`);
        continue;
      }
      if (!candidate.user?.isActive) {
        skipped.push(`${candidate.name}: user inactive`);
        continue;
      }
      const maxLeads = Number((candidate as any)?.maxLeadCapacity ?? (candidate as any)?.maxLeads ?? -1);
      const currentLeadCount = Number((candidate as any)?.currentLeadCount ?? 0);
      if (maxLeads >= 0 && currentLeadCount >= maxLeads) {
        skipped.push(`${candidate.name}: reached lead limit`);
        continue;
      }
      return { member: candidate, skipped, fallbackOwnerId: queue.defaultOwnerId || queue.ownerId || null };
    }

    return { member: null, skipped, fallbackOwnerId: queue.defaultOwnerId || queue.ownerId || null };
  }

  static async assignLead(queueId: string, leadId: string, tenantId: string) {
    return prisma.$transaction(async (tx) => this.assignLeadInTransaction(tx, queueId, leadId, tenantId));
  }

  static async assignLeadInTransaction(tx: Prisma.TransactionClient, queueId: string, leadId: string, tenantId: string) {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "RRQueue" WHERE id = ${queueId} AND "tenantId" = ${tenantId} FOR UPDATE`);
      const queue = await tx.rRQueue.findFirst({ where: { id: queueId, tenantId } });
      if (!queue) throw new Error('RR_QUEUE_NOT_FOUND');

      const lead = await tx.lead.findFirst({ where: { id: leadId, tenantId }, select: { id: true, ownerId: true, status: true, source: true } });
      if (!lead) throw new Error('LEAD_NOT_FOUND');

      const nextState = await this.getNextEligibleMember(queueId, tenantId, tx);
      let selected = nextState.member;
      const fallbackOwnerId = nextState.fallbackOwnerId || queue.ownerId || null;
      let assignmentReason = 'assigned';

      if (!selected) {
        if (!fallbackOwnerId) throw new Error('NO_ELIGIBLE_USER');
        selected = null;
        assignmentReason = 'fallback_owner';
      }
      const assignedUserId = selected ? selected.userId : fallbackOwnerId;
      if (!assignedUserId) throw new Error('NO_ELIGIBLE_USER');

      const previousId = queue.previousId;
      const leadCountBefore = queue.leadCount ?? 0;
      const nextLeadCount = leadCountBefore + 1;

      await tx.lead.update({
        where: { id: leadId },
        data: {
          ownerId: assignedUserId,
          rrQueueId: queueId,
          status: lead.status && lead.status !== 'NEW' ? lead.status : 'NEW',
        },
      });
      const updatedQueue = await tx.rRQueue.update({
        where: { id: queueId },
        data: { previousId: selected ? selected.sequenceId : queue.previousId, leadCount: nextLeadCount, noOfUsers: { increment: 0 } },
      });
      const userName = selected ? `${selected.user.firstName} ${selected.user.lastName}`.trim() : 'Default Owner';
      await tx.rRQueueHistory.createMany({
        data: [
          { tenantId, rrQueueId: queueId, leadId, field: 'Owner', userId: assignedUserId, userName, originalValue: lead.ownerId, newValue: assignedUserId },
          { tenantId, rrQueueId: queueId, leadId, field: 'Previous id', userId: assignedUserId, userName, originalValue: String(previousId), newValue: String(selected ? selected.sequenceId : queue.previousId) },
          ...(nextState.skipped.length ? [{ tenantId, rrQueueId: queueId, leadId, field: 'Skip reasons', userId: assignedUserId, userName, originalValue: JSON.stringify(nextState.skipped), newValue: assignmentReason }] : []),
        ],
      });

      return { queueId, leadId, assignedUserId, assignedUserName: userName, previousId: selected ? selected.sequenceId : queue.previousId, leadCount: updatedQueue.leadCount, skipped: nextState.skipped, assignmentReason };
  }

  static async assignSiteVisitInTransaction(
    tx: Prisma.TransactionClient,
    queueId: string,
    siteVisitId: string,
    leadId: string,
    tenantId: string,
  ) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "RRQueue" WHERE id = ${queueId} AND "tenantId" = ${tenantId} AND active = TRUE FOR UPDATE`);
    const queue = await tx.rRQueue.findFirst({ where: { id: queueId, tenantId, active: true } });
    if (!queue) throw new Error('RR_QUEUE_NOT_FOUND');

    const siteVisit = await tx.siteVisit.findFirst({
      where: { id: siteVisitId, leadId, tenantId },
      select: { id: true, assigneeId: true },
    });
    if (!siteVisit) throw new Error('SITE_VISIT_NOT_FOUND');

    const nextState = await this.getNextEligibleMember(queueId, tenantId, tx);
    const selected = nextState.member;
    if (!selected) throw new Error('NO_ELIGIBLE_USER');

    const assignedUserId = selected.userId;
    const userName = `${selected.user.firstName} ${selected.user.lastName}`.trim() || selected.user.email;
    const updatedQueue = await tx.rRQueue.update({
      where: { id: queueId },
      data: { previousId: selected.sequenceId, leadCount: { increment: 1 } },
    });
    await tx.siteVisit.update({
      where: { id: siteVisit.id },
      data: { assigneeId: assignedUserId },
    });
    await tx.rRQueueHistory.createMany({
      data: [
        {
          tenantId,
          rrQueueId: queueId,
          leadId,
          field: 'Site Visit Owner',
          userId: assignedUserId,
          userName,
          originalValue: siteVisit.assigneeId,
          newValue: assignedUserId,
        },
        {
          tenantId,
          rrQueueId: queueId,
          leadId,
          field: 'Previous id',
          userId: assignedUserId,
          userName,
          originalValue: String(queue.previousId),
          newValue: String(selected.sequenceId),
        },
        ...(nextState.skipped.length ? [{
          tenantId,
          rrQueueId: queueId,
          leadId,
          field: 'Skip reasons',
          userId: assignedUserId,
          userName,
          originalValue: JSON.stringify(nextState.skipped),
          newValue: 'assigned',
        }] : []),
      ],
    });

    return {
      queueId,
      leadId,
      siteVisitId,
      assignedUserId,
      assignedUserName: userName,
      previousId: selected.sequenceId,
      leadCount: updatedQueue.leadCount,
      skipped: nextState.skipped,
    };
  }

  static async assignLeadsInBulk(tenantId: string, leads: Array<Record<string, any>>) {
    if (!leads.length) return { assignments: [], errors: [] };
    const queueIds = Array.from(new Set(leads.map((lead) => lead.rrQueueId).filter(Boolean)));
    const queues = queueIds.length ? await prisma.rRQueue.findMany({ where: { tenantId, id: { in: queueIds } }, include: { members: { include: { user: { select: { id: true, firstName: true, lastName: true, email: true, isActive: true } } }, orderBy: { sequenceId: 'asc' } } } }) : [];
    const queueMap = new Map(queues.map((queue) => [queue.id, queue]));
    const assignments: Array<Record<string, any>> = [];
    const errors: Array<Record<string, any>> = [];

    for (const lead of leads) {
      const queue = lead.rrQueueId ? queueMap.get(lead.rrQueueId) : null;
      if (!queue) {
        errors.push({ leadId: lead.id, reason: 'Queue not found' });
        continue;
      }
      const nextState = await this.getNextEligibleMember(queue.id, tenantId, prisma);
      if (!nextState.member) {
        errors.push({ leadId: lead.id, queueId: queue.id, reason: 'No active member available', fallbackOwnerId: nextState.fallbackOwnerId || queue.ownerId || null });
        continue;
      }
      assignments.push({
        leadId: lead.id,
        queueId: queue.id,
        assignedUserId: nextState.member.userId,
        previousId: queue.previousId,
        leadCount: (queue.leadCount || 0) + assignments.filter((item) => item.queueId === queue.id).length + 1,
        skipped: nextState.skipped,
      });
    }

    return { assignments, errors };
  }

  static async resetQueuePointer(queueId: string, tenantId: string) {
    return prisma.rRQueue.updateMany({ where: { id: queueId, tenantId }, data: { previousId: 0 } });
  }
}

export async function findApplicableRRQueue(
  tenantId: string,
  criteria: {
    projectId?: string | null;
    projectName?: string | null;
    status?: string | null;
    source?: string | null;
    secondarySource?: string | null;
    tertiarySource?: string | null;
    priority?: string | null;
    category?: string | null;
  },
  tx: RRClient = prisma,
) {
  const queues = await tx.rRQueue.findMany({ where: { tenantId, active: true }, orderBy: { createdAt: 'asc' } });
  if (queues.length === 0) return null;

  let resolvedProjectName: string | null = criteria.projectName ?? null;
  if (!resolvedProjectName && criteria.projectId) {
    const project = await tx.project.findFirst({ where: { id: criteria.projectId, tenantId }, select: { name: true } });
    resolvedProjectName = project?.name ?? null;
  }

  const lead = {
    status: criteria.status ?? null,
    source: criteria.source ?? null,
    secondarySource: criteria.secondarySource ?? null,
    tertiarySource: criteria.tertiarySource ?? null,
    priority: criteria.priority ?? null,
    category: criteria.category ?? null,
    projectId: criteria.projectId ?? null,
    projectName: resolvedProjectName,
  };

  const scoredQueues = queues
    .map((queue) => ({ queue, score: calculateQueueMatchScore(queue as Record<string, any>, lead) }))
    .filter(({ score, queue }) => {
      const configuredSource = normalizeList((queue as Record<string, any>)?.leadSource ?? (queue as Record<string, any>)?.sources ?? (queue as Record<string, any>)?.source ?? (queue as Record<string, any>)?.leadSources);
      const directSourceMatch = !!lead.source && matchesValue(lead.source, configuredSource);
      const noSourceFallback = isNoSourceQueue(queue as Record<string, any>) && !!lead.source && !directSourceMatch && !matchesValue(lead.source, normalizeList((queue as Record<string, any>)?.excludeFromNoSource ?? (queue as Record<string, any>)?.excludedSources ?? (queue as Record<string, any>)?.excludeFromNoSourceList));
      return score > 0 || noSourceFallback || (configuredSource.length === 0 && projectMatchesLead(queue as Record<string, any>, criteria.projectId ?? null, resolvedProjectName) && (!lead.status || normalizeList((queue as Record<string, any>)?.leadStatus ?? (queue as Record<string, any>)?.statuses ?? (queue as Record<string, any>)?.status).length === 0 || matchesValue(lead.status, normalizeList((queue as Record<string, any>)?.leadStatus ?? (queue as Record<string, any>)?.statuses ?? (queue as Record<string, any>)?.status))));
    });

  if (scoredQueues.length === 0) return null;
  scoredQueues.sort((left, right) => right.score - left.score);
  return scoredQueues[0].queue;
}