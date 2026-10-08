import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OpportunityDetailPage from "./page";

const mocks = vi.hoisted(() => ({
  getOpportunity: vi.fn(),
  push: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "opportunity-a" }),
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/lib/api", () => ({
  opportunityApi: { get: mocks.getOpportunity },
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ hasEffectivePermission: () => false }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

describe("OpportunityDetailPage GRE snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOpportunity.mockResolvedValue({
      data: {
        success: true,
        data: {
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
        },
      },
    });
  });

  it("loads and renders the latest GRE registration on a direct Opportunity URL", async () => {
    render(<OpportunityDetailPage />);

    expect(await screen.findByText("Latest GRE Registration")).toBeInTheDocument();
    expect(screen.getByText("GRE-2026-000002")).toBeInTheDocument();
    expect(screen.getByText("Updated Customer")).toBeInTheDocument();
    expect(screen.getByText("updated@example.com")).toBeInTheDocument();
    expect(screen.getByText("New project")).toBeInTheDocument();
    await waitFor(() => expect(mocks.getOpportunity).toHaveBeenCalledWith("opportunity-a"));
  });
});
