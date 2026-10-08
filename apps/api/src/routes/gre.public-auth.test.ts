import express from 'express';
import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  formFindUnique: vi.fn(),
  projectFindMany: vi.fn(),
}));

vi.mock('@dct-crm/db', () => ({
  prisma: {
    greForm: { findUnique: database.formFindUnique },
    project: { findMany: database.projectFindMany },
  },
}));

vi.mock('../middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (!req.headers.authorization) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    next();
  },
}));

vi.mock('../middleware/authorization', () => ({
  authorize: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../middleware/audit', () => ({
  auditLog: vi.fn(),
}));

vi.mock('../services/leadWorkflowExtras', () => ({
  getNextSiteVisitNumber: vi.fn(),
}));

vi.mock('../services/ownerHistory', () => ({
  createOwnerHistory: vi.fn(),
}));

vi.mock('../services/rrQueue', () => ({
  findApplicableRRQueue: vi.fn(),
  getReusableSiteVisitOwner: vi.fn(),
  isNewProjectSiteVisit: vi.fn(),
  isSiteVisitRevisit: vi.fn(),
  RoundRobinAssignmentService: vi.fn(),
}));

import { greRoutes } from './gre';

const servers: Server[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  database.formFindUnique.mockResolvedValue({
    id: 'form-a',
    tenantId: 'tenant-a',
    name: 'Public GRE',
    publicToken: 'public-token',
    isActive: true,
    expiresAt: null,
    defaultProjectId: null,
    tenant: { id: 'tenant-a', name: 'Example Tenant', isActive: true },
  });
  database.projectFindMany.mockResolvedValue([
    { id: 'project-a', name: 'Example Project', city: 'Example City' },
  ]);
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe('GET /api/gre/public/:token authentication', () => {
  it('loads an active public GRE form without an authenticated session', async () => {
    const app = express();
    app.use('/api/gre', greRoutes);
    const server = app.listen(0);
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');

    const response = await fetch(`http://127.0.0.1:${address.port}/api/gre/public/public-token`);
    const body = await response.json() as {
      success: boolean;
      data: { formName: string; tenantName: string; projects: { id: string; name: string }[] };
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: {
        formName: 'Public GRE',
        tenantName: 'Example Tenant',
        projects: [{ id: 'project-a', name: 'Example Project' }],
      },
    });
  });
});
