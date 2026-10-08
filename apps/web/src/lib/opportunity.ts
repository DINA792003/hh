export interface OpportunityGreRegistration {
  referenceNumber: string | null;
  submittedAt: string | null;
  lead: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    company: string | null;
    budget: number | null;
    preferredLocation: string | null;
  };
  siteVisit: {
    date: string | null;
    time: string | null;
    project: string | null;
    scheduledAt: string | null;
    visitType: string | null;
    visitorCount: number | null;
  };
  company: {
    name: string | null;
    type: string | null;
    industry: string | null;
  };
}

export interface OpportunityApiRecord {
  id: string;
  name: string | null;
  amount: number | null;
  stage: string | null;
  probability: number | null;
  expectedCloseDate: string | null;
  closeDate?: string | null;
  createdAt: string;
  updatedAt: string;
  description?: string | null;
  owner?: { firstName: string | null; lastName: string | null } | null;
  lead?: {
    id: string;
    leadNumber: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    mobile: string | null;
    company: string | null;
    budget: number | null;
    preferredLocation: string | null;
    project: { id: string; name: string } | null;
  } | null;
  greRegistration?: OpportunityGreRegistration | null;
}

export interface OpportunityView {
  id: string;
  title: string;
  value: number;
  stage: string;
  probability: number;
  closeDate: string;
  assignedTo: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  currency?: string;
  lead: OpportunityApiRecord["lead"];
  greRegistration: OpportunityGreRegistration | null;
}

export function mapOpportunity(item: OpportunityApiRecord): OpportunityView {
  return {
    id: item.id,
    title: item.name || "Untitled Opportunity",
    value: item.amount || 0,
    stage: (item.stage || "prospecting").toLowerCase().replace(/_/g, "-"),
    probability: item.probability ?? 0,
    closeDate: item.expectedCloseDate || item.closeDate || item.createdAt,
    assignedTo: item.owner
      ? `${item.owner.firstName || ""} ${item.owner.lastName || ""}`.trim()
      : "—",
    description: item.description || undefined,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    currency: "INR",
    lead: item.lead || null,
    greRegistration: item.greRegistration || null,
  };
}
