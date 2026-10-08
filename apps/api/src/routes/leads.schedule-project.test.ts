import express from 'express';
import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  leadCreate: vi.fn(),
  leadFindFirst: vi.fn(),
  leadFindMany: vi.fn(),
  leadFindUnique: vi.fn(),
  projectFindFirst: vi.fn(),
  sequenceUpsert: vi.fn(),
  transaction: vi.fn(),
}));

const rrQueue = vi.hoisted(() => ({
  assignLeadInTransaction: vi.fn(),
  findApplicableRRQueue: vi.fn(),
}));

vi.mock('@dct-crm/db', () => ({
  prisma: {
    lead: {
      create: database.leadCreate,
      findFirst: database.leadFindFirst,
      findMany: database.leadFindMany,
      findUnique: database.leadFindUnique,
    },
    $transaction: database.transaction,
  },
}));

vi.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = {
      id: 'svc-a',
      tenantId: 'tenant-a',
      isSuperAdmin: false,
      profileName: 'SVC',
    };
    req.tenantId = 'tenant-a';
    next();
  },
}));

vi.mock('../middleware/authorization', () => ({
  authorize: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../services/workflow', () => ({
  canTransitionStatus: () => true,
  isValidStatus: () => true,
}));

vi.mock('../services/ownerHistory', () => ({
  createOwnerHistory: vi.fn(),
  getOwnerHistory: vi.fn(),
}));

vi.mock('../services/recordAccess', () => ({
  canAccessLead: vi.fn().mockResolvedValue(true),
  getLeadRecordScope: vi.fn(),
  leadScopeClause: vi.fn(),
}));

vi.mock('../services/leadWorkflowExtras', () => ({
  getNextSiteVisitNumber: vi.fn(),
  normalizeOverdueSiteVisits: vi.fn(),
}));

vi.mock('../services/rrQueue', () => ({
  findApplicableRRQueue: rrQueue.findApplicableRRQueue,
  hasLeadAssignmentRelevantChanges: vi.fn(),
  isLeadEligibleForAutoAssignment: () => true,
  RoundRobinAssignmentService: {
    assignLeadInTransaction: rrQueue.assignLeadInTransaction,
  },
}));

vi.mock('../services/leadOwnerChange', () => ({
  changeLeadOwner: vi.fn(),
  getEligibleLeadOwners: vi.fn(),
}));

import { leadRoutes as leadsRouter } from './leads';

const servers: Server[] = [];

async function scheduleSiteVisit(body: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use('/api/leads', leadsRouter);
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
  return fetch(`http://127.0.0.1:${address.port}/api/leads/lead-a/schedule-site-visit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function convertLead(body: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use('/api/leads', leadsRouter);
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
  return fetch(`http://127.0.0.1:${address.port}/api/leads/lead-a/convert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  database.leadFindFirst.mockResolvedValue({
    id: 'lead-a',
    tenantId: 'tenant-a',
    ownerId: 'svc-a',
    creatorId: null,
    status: 'PROSPECT',
    owner: { id: 'svc-a', firstName: 'SVC', lastName: 'User' },
  });
  database.projectFindFirst.mockResolvedValue(null);
  database.leadFindMany.mockResolvedValue([]);
  database.transaction.mockImplementation((callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      lead: {
        create: database.leadCreate,
        findFirst: database.leadFindFirst,
        findMany: database.leadFindMany,
        findUnique: database.leadFindUnique,
      },
      project: { findFirst: database.projectFindFirst },
      sequence: { upsert: database.sequenceUpsert },
      auditLog: { create: vi.fn() },
    }),
  );
  database.sequenceUpsert.mockResolvedValue({ nextValue: 1 });
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe('POST /api/leads/:id/schedule-site-visit project validation', () => {
  it('rejects a project outside the authenticated tenant before assignment or creation', async () => {
    const response = await scheduleSiteVisit({
      projectId: 'project-from-tenant-b',
      notes: 'Customer requested a visit',
      scheduledAt: '2026-10-01T09:00:00.000Z',
      tenantId: 'tenant-b',
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ success: false, error: 'Project not found' });
    expect(database.projectFindFirst).toHaveBeenCalledWith({
      where: { id: 'project-from-tenant-b', tenantId: 'tenant-a', isActive: true },
      select: { id: true },
    });
  });

  it('rejects malformed visit dates before starting a transaction', async () => {
    const response = await scheduleSiteVisit({
      projectId: 'project-a',
      notes: 'Customer requested a visit',
      scheduledAt: 'not-a-date',
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ success: false, error: 'Visit date/time is required' });
    expect(database.transaction).not.toHaveBeenCalled();
  });
});

describe('POST /api/leads/:id/convert project validation', () => {
  it('rejects a project that differs from the completed Site Visit project', async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      lead: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'lead-a',
          tenantId: 'tenant-a',
          ownerId: 'svc-a',
          creatorId: null,
          status: 'SITE_VISIT_HAPPENED',
          company: 'Example',
          owner: { id: 'svc-a', firstName: 'SVC', lastName: 'User' },
          siteVisits: [{ projectId: 'visit-project-a' }],
          opportunities: [],
        }),
      },
      project: { findFirst: database.projectFindFirst },
    };
    database.transaction.mockImplementation((callback: (client: unknown) => Promise<unknown>) =>
      callback(tx),
    );

    const response = await convertLead({ projectId: 'different-project', name: 'Example Opportunity' });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      success: false,
      error: 'Opportunity project must match the completed Site Visit project',
    });
    expect(database.projectFindFirst).not.toHaveBeenCalled();
    expect(tx.lead.findFirst).toHaveBeenCalled();
  });
});

describe('POST /api/leads Round Robin assignment', () => {
  it('creates the lead when a matching queue has no eligible Sales user and reports the pending assignment', async () => {
    const createdLead = {
      id: 'lead-new',
      leadNumber: 'LN000001',
      firstName: 'New',
      lastName: 'Customer',
      company: 'Example',
      source: 'WEBSITE',
      projectId: 'project-a',
      project: { id: 'project-a', name: 'Project A' },
      owner: { id: 'admin-a', firstName: 'Admin', lastName: 'User' },
    };
    database.leadCreate.mockResolvedValue(createdLead);
    rrQueue.findApplicableRRQueue.mockResolvedValue({ id: 'queue-a' });
    rrQueue.assignLeadInTransaction.mockRejectedValue(new Error('NO_ELIGIBLE_USER'));

    const app = express();
    app.use(express.json());
    app.use('/api/leads', leadsRouter);
    const server = app.listen(0);
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');

    const response = await fetch(`http://127.0.0.1:${address.port}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lastName: 'Customer',
        company: 'Example',
        phone: '9876543210',
        source: 'WEBSITE',
        projectId: 'project-a',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(database.leadCreate).toHaveBeenCalledOnce();
    expect(body).toMatchObject({
      success: true,
      data: {
        id: 'lead-new',
        assignmentWarning: expect.stringContaining('no eligible Sales user'),
      },
    });
  });
});