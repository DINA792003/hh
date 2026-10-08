import { describe, expect, it } from "vitest";
import { mapOpportunity } from "./opportunity";

describe("mapOpportunity", () => {
  it("keeps the latest GRE snapshot separate from older Lead fields", () => {
    const opportunity = mapOpportunity({
      id: "opportunity-a",
      name: "Old opportunity name",
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
    });

    expect(opportunity.title).toBe("Old opportunity name");
    expect(opportunity.lead?.firstName).toBe("Old");
    expect(opportunity.greRegistration?.lead.firstName).toBe("Updated");
    expect(opportunity.greRegistration?.siteVisit.project).toBe("New project");
  });
});
