import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OpportunitiesPage from "./page";

const mocks = vi.hoisted(() => ({
  listOpportunities: vi.fn(),
  push: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/lib/api", () => ({
  opportunityApi: {
    list: mocks.listOpportunities,
    updateStage: vi.fn(),
  },
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ hasEffectivePermission: () => false }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

describe("OpportunitiesPage GRE snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listOpportunities.mockResolvedValue({
      data: {
        success: true,
        data: [{
          id: "opportunity-a",
          name: "Legacy opportunity title",
          amount: 100000,
          stage: "PROSPECTING",
          probability: 10,
          expectedCloseDate: null,
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-02T00:00:00.000Z",
          lead: {
            id: "lead-a",
            leadNumber: "LD-001",
            firstName: "Old",
            lastName: "Lead",
            email: "old@example.com",
            phone: "1111111111",
            mobile: null,
            company: "Old company",
            budget: 100000,
            preferredLocation: "Old area",
            project: { id: "project-a", name: "Old project" },
          },
          greRegistration: {
            referenceNumber: "GRE-2026-000002",
            submittedAt: "2026-10-07T10:00:00.000Z",
            lead: {
              firstName: "Updated",
              lastName: "Customer",
              email: "updated@example.com",
              phone: "+919876543210",
              company: "Updated company",
              budget: 500000,
              preferredLocation: "New area",
            },
            siteVisit: {
              date: "2026-10-07",
              time: "15:30",
              project: "New project",
              scheduledAt: "2026-10-07T10:00:00.000Z",
              visitType: "Revisit",
              visitorCount: 2,
            },
            company: { name: "Updated company", type: "Builder", industry: "REAL_ESTATE" },
          },
        }],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      },
    });
  });

  it("shows current GRE data in both pipeline and list views after a fresh load", async () => {
    render(<OpportunitiesPage />);

    expect(await screen.findByText(/GRE GRE-2026-000002/)).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /list/i }), { button: 0, ctrlKey: false });

    const table = await screen.findByRole("table");
    expect(within(table).getByText(/Updated Customer/)).toBeInTheDocument();
    expect(within(table).getByText(/New project/)).toBeInTheDocument();
    expect(within(table).getByText("GRE-2026-000002")).toBeInTheDocument();
    expect(mocks.listOpportunities).toHaveBeenCalledWith({ page: 1, limit: 20 });
  });
});
