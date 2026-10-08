import express from 'express';
import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  opportunityFindMany: vi.fn(),
  opportunityCount: vi.fn(),
  opportunityFindFirst: vi.fn(),
  opportunityCreate: vi.fn(),
  opportunityUpdate: vi.fn(),
  auditLog: vi.fn(),
}));

vi.mock('@dct-crm/db', () => ({
  prisma: {
    opportunity: {
      findMany: database.opportunityFindMany,
      count: database.opportunityCount,
      findFirst: database.opportunityFindFirst,
      create: database.opportunityCreate,
      update: database.opportunityUpdate,
    },
  },
}));

vi.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-a', tenantId: 'tenant-a', isSuperAdmin: false };
    req.tenantId = 'tenant-a';
    next();
  },
}));

vi.mock('../middleware/authorization', () => ({
  authorize: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../middleware/audit', () => ({
  auditLog: database.auditLog,
}));

vi.mock('../services/recordAccess', () => ({
  getOpportunityVisibilityFilter: vi.fn().mockResolvedValue({ tenantId: 'tenant-a' }),
}));

import opportunitiesRouter from './opportunities';

const servers: Server[] = [];
type ApiResponse<T> = { success: boolean; data: T };

const opportunity = {
  id: 'opportunity-a',
  tenantId: 'tenant-a',
  name: 'Original opportunity',
  amount: 250000,
  stage: 'PROSPECTING',
  probability: 20,
  expectedCloseDate: null,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-02T00:00:00.000Z'),
  description: null,
  lead: {
    id: 'lead-a',
    leadNumber: 'LD-001',
    firstName: 'Old',
    lastName: 'Lead',
    email: 'old@example.com',
    phone: '1111111111',
    mobile: null,
    company: 'Old Company',
    budget: 100000,
    preferredLocation: 'Old area',
    project: { id: 'project-old', name: 'Old project' },
    greSessions: [{
      referenceNumber: 'GRE-2026-000002',
      completedAt: new Date('2026-10-07T10:00:00.000Z'),
      phone: '+919876543210',
      draft: {
        lead: {
          firstName: 'Updated',
          lastName: 'Customer',
          email: 'updated@example.com',
          budget: 500000,
          preferredLocation: 'New area',
        },
        siteVisit: {
          date: '2026-10-07',
          time: '15:30',
          visitType: 'Revisit',
          visitorCount: 2,
        },
        company: { name: 'Updated Company', type: 'Builder', industry: 'REAL_ESTATE' },
      },
      siteVisit: {
        scheduledAt: new Date('2026-10-07T10:00:00.000Z'),
        project: { name: 'New project' },
      },
    }],
  },
  owner: { id: 'user-a', firstName: 'Sales', lastName: 'User' },
  creator: { id: 'user-a', firstName: 'Sales', lastName: 'User' },
  project: { id: 'project-new', name: 'New project' },
};

async function request(method: string, path: string, body?: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use('/api/opportunities', opportunitiesRouter);
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
  return fetch(`http://127.0.0.1:${address.port}/api/opportunities${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  database.opportunityFindMany.mockResolvedValue([opportunity]);
  database.opportunityCount.mockResolvedValue(1);
  database.opportunityFindFirst.mockResolvedValue(opportunity);
  database.opportunityCreate.mockResolvedValue(opportunity);
  database.opportunityUpdate.mockResolvedValue(opportunity);
  database.auditLog.mockResolvedValue(undefined);
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe('Opportunity GRE registration integration', () => {
  it('returns the latest completed GRE snapshot in the Opportunity list', async () => {
    const response = await request('GET', '/');
    const body = await response.json() as ApiResponse<Array<{ greRegistration: Record<string, unknown> }>>;

    expect(response.status).toBe(200);
    expect(body.data[0].greRegistration).toMatchObject({
      referenceNumber: 'GRE-2026-000002',
      lead: {
        firstName: 'Updated',
        lastName: 'Customer',
        email: 'updated@example.com',
        phone: '+919876543210',
        company: 'Updated Company',
        budget: 500000,
        preferredLocation: 'New area',
      },
      siteVisit: {
        date: '2026-10-07',
        time: '15:30',
        project: 'New project',
        visitType: 'Revisit',
        visitorCount: 2,
      },
    });
    expect(database.opportunityFindMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        lead: expect.objectContaining({
          select: expect.objectContaining({
            greSessions: expect.objectContaining({
              where: { status: 'COMPLETED' },
              take: 1,
              orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
            }),
          }),
        }),
      }),
    }));
  });

  it('returns the current GRE snapshot on direct Opportunity reads and create/update responses', async () => {
    const readResponse = await request('GET', '/opportunity-a');
    const readBody = await readResponse.json() as ApiResponse<{ greRegistration: { lead: { firstName: string } } }>;
    expect(readResponse.status).toBe(200);
    expect(readBody.data.greRegistration.lead.firstName).toBe('Updated');

    const createResponse = await request('POST', '/', { name: 'New opportunity' });
    const createBody = await createResponse.json() as ApiResponse<{ greRegistration: { referenceNumber: string } }>;
    expect(createResponse.status).toBe(201);
    expect(createBody.data.greRegistration.referenceNumber).toBe('GRE-2026-000002');

    const updateResponse = await request('PUT', '/opportunity-a', { name: 'Updated opportunity' });
    const updateBody = await updateResponse.json() as ApiResponse<{ greRegistration: { referenceNumber: string } }>;
    expect(updateResponse.status).toBe(200);
    expect(updateBody.data.greRegistration.referenceNumber).toBe('GRE-2026-000002');
  });
});
