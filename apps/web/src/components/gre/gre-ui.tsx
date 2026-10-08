"use client";

import * as React from "react";

import { ArrowLeft, Briefcase, Building2, Check, Copy, ExternalLink, FileCode2, FileText, Home, Plus, RefreshCw, AlertCircle, CheckCircle2, Loader2, ShieldCheck, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";

import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";

import { Label } from "@/components/ui/label";

import { useToast } from "@/hooks/use-toast";

import { greApi, projectApi } from "@/lib/api";

import { useParams } from "next/navigation";

import { Textarea } from "@/components/ui/textarea";



interface GreFormLink {
  id: string;
  name: string;
  publicUrl: string;
  isActive: boolean;
  expiresAt: string | null;
  defaultProjectId: string | null;
  sessions: number;
  createdAt: string;
}

interface GreSubmission {
  id: string;
  referenceNumber: string | null;
  name: string;
  phone: string | null;
  leadNumber: string | null;
  leadId: string | null;
  leadStatus: string | null;
  leadWasExisting: boolean | null;
  company: string;
  siteVisitNumber: string | null;
  siteVisitAt: string | null;
  siteVisitStatus: string | null;
  project: string;
  status: string;
  createdAt: string;
}

interface ProjectOption {
  id: string;
  name: string;
}

interface PublicLeadDetails {
  id: string;
  leadNumber: string | null;
  firstName: string | null;
  lastName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  secondaryPhone: string | null;
  tertiaryPhone: string | null;
  company: string;
  industry: string | null;
  budget: number | null;
  requirements: string | null;
  source: string;
  status: string;
  leadSubSource: string | null;
  campaign: string | null;
  leadType: string | null;
  preferredLocation: string | null;
  occupation: string | null;
  gender: string | null;
  project: { id: string; name: string; city: string | null } | null;
  siteVisits: { projectId: string | null; status: string; scheduledAt: string; visitType: string | null }[];
  companyAccount: {
    name: string;
    companyType: string | null;
    industry: string | null;
    email: string | null;
    phone: string | null;
    website: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
  } | null;
}

interface SubmissionFilters {
  phone: string;
  projectId: string;
  from: string;
  to: string;
  leadStatus: string;
  siteVisitStatus: string;
  existingLead: string;
}

const emptySubmissionFilters: SubmissionFilters = {
  phone: "",
  projectId: "",
  from: "",
  to: "",
  leadStatus: "",
  siteVisitStatus: "",
  existingLead: "",
};

const leadStatuses = ["NEW", "INCOMING", "PROSPECT", "SITE_VISIT_SCHEDULED", "SITE_VISIT_HAPPENED", "BOOKED", "LOST"];
const siteVisitStatuses = ["SCHEDULED", "COMPLETED", "CANCELLED"];

export function GreSetupPage() {
  const { toast } = useToast();
  const [forms, setForms] = React.useState<GreFormLink[]>([]);
  const [submissions, setSubmissions] = React.useState<GreSubmission[]>([]);
  const [projects, setProjects] = React.useState<ProjectOption[]>([]);
  const [formName, setFormName] = React.useState("General Registration Enquiry");
  const [defaultProjectId, setDefaultProjectId] = React.useState("");
  const [expiresAt, setExpiresAt] = React.useState("");
  const [isCreating, setIsCreating] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isLoadingSubmissions, setIsLoadingSubmissions] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [filterValues, setFilterValues] = React.useState<SubmissionFilters>(emptySubmissionFilters);
  const [appliedFilters, setAppliedFilters] = React.useState<SubmissionFilters>(emptySubmissionFilters);
  const [copiedId, setCopiedId] = React.useState("");

  const loadData = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const [formResponse, projectResponse] = await Promise.all([
        greApi.listForms(),
        projectApi.listAll({ isActive: "true" }),
      ]);
      setForms(formResponse.data.data || []);
      setProjects(projectResponse);
    } catch (error: any) {
      console.error("Load GRE setup data error:", error);
      toast({ title: "Unable to load GRE setup", description: error?.response?.data?.error || "Please try again.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const loadSubmissions = React.useCallback(async (filters: SubmissionFilters) => {
    setIsLoadingSubmissions(true);
    try {
      const params = Object.fromEntries(
        Object.entries(filters).filter(([, value]) => value.trim()),
      );
      const response = await greApi.listSubmissions({ ...params, limit: "100", page: "1" });
      setSubmissions(response.data.data || []);
    } catch (error: any) {
      console.error("Load GRE submissions error:", error);
      toast({ title: "Unable to load GRE submissions", description: error?.response?.data?.error || "Please try again.", variant: "destructive" });
    } finally {
      setIsLoadingSubmissions(false);
    }
  }, [toast]);

  React.useEffect(() => { void loadData(); }, [loadData]);
  React.useEffect(() => {
    void loadSubmissions(appliedFilters);
  }, [loadSubmissions, appliedFilters]);

  const createForm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      const response = await greApi.createForm({
        name: formName.trim(),
        defaultProjectId: defaultProjectId || null,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      const created = response.data.data as GreFormLink;
      setForms((current) => [created, ...current]);
      setIsCreating(false);
      setExpiresAt("");
      toast({ title: "GRE link created", description: "Your secure public form link is ready to share." });
      await copyLink(created.publicUrl, created.id);
    } catch (error: any) {
      toast({ title: "Unable to create GRE link", description: error?.response?.data?.error || "Please review the form and try again.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyLink = async (url: string, id: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(""), 1800);
      toast({ title: "Link copied", description: "The GRE link is ready to share." });
    } catch (error) {
      console.error("Copy GRE link error:", error);
      toast({ title: "Could not copy automatically", description: url, variant: "destructive" });
    }
  };

  const toggleForm = async (form: GreFormLink) => {
    try {
      const response = await greApi.updateForm(form.id, { isActive: !form.isActive });
      const updated = response.data.data as GreFormLink;
      setForms((current) => current.map((item) => item.id === form.id ? { ...item, ...updated } : item));
      toast({ title: updated.isActive ? "GRE link enabled" : "GRE link disabled" });
    } catch (error: any) {
      toast({ title: "Unable to update GRE link", description: error?.response?.data?.error || "Please try again.", variant: "destructive" });
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col justify-between gap-4 border-b pb-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Setup / GRE</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">GRE Forms</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Generate secure public General Registration Enquiry links and review submissions connected to your Leads, Companies, Projects, and Site Visits.
          </p>
        </div>
        <Button onClick={() => setIsCreating((current) => !current)}>
          <Plus className="h-4 w-4" /> Create GRE link
        </Button>
      </header>

      {isCreating && (
        <form onSubmit={createForm} className="grid gap-4 rounded-lg border bg-card p-5 shadow-sm md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="gre-name">Link name</Label>
            <Input id="gre-name" required maxLength={100} value={formName} onChange={(event) => setFormName(event.target.value)} placeholder="General Registration Enquiry" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gre-project">Default project (optional)</Label>
            <select id="gre-project" value={defaultProjectId} onChange={(event) => setDefaultProjectId(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[13px]">
              <option value="">No default project</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="gre-expiry">Link expiry (optional)</Label>
            <Input id="gre-expiry" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
          </div>
          <div className="flex items-end justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setIsCreating(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Generating…" : "Generate link"}</Button>
          </div>
        </form>
      )}

      <section className="space-y-3" aria-labelledby="gre-links-title">
        <div className="flex items-center justify-between">
          <div>
            <h2 id="gre-links-title" className="font-semibold">Public GRE links</h2>
            <p className="text-sm text-muted-foreground">Share links with customers. Disable or expire a link at any time.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => { void loadData(); void loadSubmissions(appliedFilters); }} disabled={isLoading || isLoadingSubmissions}><RefreshCw className="h-4 w-4" /> Refresh</Button>
        </div>
        {isLoading ? (
          <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground" role="status">Loading GRE links…</div>
        ) : forms.length ? (
          <div className="divide-y rounded-lg border bg-card">
            {forms.map((form) => (
              <div key={form.id} className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="rounded-md bg-primary/10 p-2 text-primary"><FileCode2 className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium">{form.name}</h3>
                      <Badge variant={form.isActive ? "default" : "secondary"}>{form.isActive ? "Active" : "Disabled"}</Badge>
                    </div>
                    <a href={form.publicUrl} target="_blank" rel="noreferrer" className="mt-1 block truncate text-sm text-primary hover:underline">
                      {form.publicUrl} <ExternalLink className="inline h-3 w-3" />
                    </a>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {form.sessions} {form.sessions === 1 ? "session" : "sessions"}
                      {form.expiresAt ? ` · Expires ${new Date(form.expiresAt).toLocaleString()}` : " · No expiry"}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => void copyLink(form.publicUrl, form.id)}>
                    {copiedId === form.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copiedId === form.id ? "Copied" : "Copy link"}
                  </Button>
                  <Button type="button" size="sm" variant={form.isActive ? "secondary" : "outline"} onClick={() => void toggleForm(form)}>
                    {form.isActive ? "Disable" : "Enable"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <FileCode2 className="mx-auto h-8 w-8 text-muted-foreground" />
            <h3 className="mt-3 font-medium">No GRE links yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">Generate a link to share the phone-first registration form.</p>
          </div>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="gre-submissions-title">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="gre-submissions-title" className="font-semibold">Completed submissions</h2>
            <p className="text-sm text-muted-foreground">Showing the latest 100 registrations.</p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => void loadSubmissions(appliedFilters)} disabled={isLoadingSubmissions}><RefreshCw className="h-4 w-4" />Refresh</Button>
        </div>

        <form
          className="grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-2 xl:grid-cols-4"
          onSubmit={(event) => { event.preventDefault(); setAppliedFilters({ ...filterValues }); }}
        >
          <FilterField label="Phone number">
            <Input aria-label="Phone number filter" value={filterValues.phone} onChange={(event) => setFilterValues((current) => ({ ...current, phone: event.target.value }))} placeholder="Enter phone number" />
          </FilterField>
          <FilterField label="Project">
            <FilterSelect aria-label="Project filter" value={filterValues.projectId} onChange={(value) => setFilterValues((current) => ({ ...current, projectId: value }))}>
              <option value="">All projects</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </FilterSelect>
          </FilterField>
          <FilterField label="From">
            <Input aria-label="Submitted from date" type="date" value={filterValues.from} onChange={(event) => setFilterValues((current) => ({ ...current, from: event.target.value }))} />
          </FilterField>
          <FilterField label="To">
            <Input aria-label="Submitted to date" type="date" value={filterValues.to} onChange={(event) => setFilterValues((current) => ({ ...current, to: event.target.value }))} />
          </FilterField>
          <FilterField label="Lead status">
            <FilterSelect aria-label="Lead status filter" value={filterValues.leadStatus} onChange={(value) => setFilterValues((current) => ({ ...current, leadStatus: value }))}>
              <option value="">All statuses</option>
              {leadStatuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
            </FilterSelect>
          </FilterField>
          <FilterField label="Site visit status">
            <FilterSelect aria-label="Site visit status filter" value={filterValues.siteVisitStatus} onChange={(value) => setFilterValues((current) => ({ ...current, siteVisitStatus: value }))}>
              <option value="">Any status</option>
              {siteVisitStatuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
            </FilterSelect>
          </FilterField>
          <FilterField label="Lead record">
            <FilterSelect aria-label="Lead record filter" value={filterValues.existingLead} onChange={(value) => setFilterValues((current) => ({ ...current, existingLead: value }))}>
              <option value="">Existing and new</option>
              <option value="true">Existing lead</option>
              <option value="false">New lead</option>
            </FilterSelect>
          </FilterField>
          <div className="flex items-end gap-2">
            <Button type="submit" size="sm">Apply filters</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => { setFilterValues(emptySubmissionFilters); setAppliedFilters(emptySubmissionFilters); }}>Clear</Button>
          </div>
        </form>

        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Reference</th>
                <th className="px-4 py-3 font-medium">Name / Phone</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Lead match</th>
                <th className="px-4 py-3 font-medium">Site Visit / Project</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {submissions.map((item) => (
                <tr key={item.id} className="hover:bg-muted/20">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{item.referenceNumber || "—"}</td>
                  <td className="px-4 py-3"><div className="font-medium">{item.name || "—"}</div><div className="text-xs text-muted-foreground">{item.phone || "—"}</div><div className="text-xs text-muted-foreground">{item.leadNumber || ""}</div></td>
                  <td className="px-4 py-3">{item.company || "—"}</td>
                  <td className="px-4 py-3">{item.leadWasExisting ? "Existing lead" : "New lead"}</td>
                  <td className="px-4 py-3"><div>{item.project || "—"}</div><div className="text-xs text-muted-foreground">{item.siteVisitAt ? new Date(item.siteVisitAt).toLocaleString() : "No visit"}</div></td>
                  <td className="px-4 py-3"><div>COMPLETED</div><div className="text-xs text-muted-foreground">{item.leadStatus ? item.leadStatus.replaceAll("_", " ") : ""}{item.siteVisitStatus ? ` · ${item.siteVisitStatus}` : ""}</div></td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {!isLoadingSubmissions && submissions.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No completed submissions match these filters.</td></tr>}
              {isLoadingSubmissions && <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">Loading submissions…</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block min-w-0 space-y-1.5 text-xs font-medium">{label}{children}</label>;
}

function FilterSelect({
  children,
  value,
  onChange,
  "aria-label": ariaLabel,
}: {
  children: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  "aria-label": string;
}) {
  return <select aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.currentTarget.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[13px] font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring">{children}</select>;
}

interface Project {
  id: string;
  name: string;
  city?: string | null;
}

interface FormMeta {
  formName: string;
  tenantName: string;
  defaultProjectId: string | null;
  projects: Project[];
}

interface Draft {
  lead: {
    firstName: string;
    lastName: string;
    secondaryPhone: string;
    tertiaryPhone: string;
    email: string;
    alternateEmail: string;
    leadSubSource: string;
    campaign: string;
    projectId: string;
    leadType: string;
    preferredLocation: string;
    budget: number | null;
    occupation: string;
    comments: string;
    dateOfBirth: string;
    gender: string;
  };
  siteVisit: {
    required: boolean;
    date: string;
    time: string;
    projectId: string;
    visitorCount: number | null;
    visitType: string;
    preferredLocation: string;
    transportRequired: boolean | null;
    comments: string;
  };
  company: {
    name: string;
    type: string;
    industry: string;
    email: string;
    phone: string;
    website: string;
    address: string;
    city: string;
    state: string;
    country: string;
    postalCode: string;
    designation: string;
    department: string;
    numberOfEmployees: number | null;
    gstNumber: string;
    comments: string;
  };
}

const emptyDraft: Draft = {
  lead: {
    firstName: "", lastName: "", secondaryPhone: "", tertiaryPhone: "", email: "", alternateEmail: "",
    leadSubSource: "", campaign: "", projectId: "", leadType: "", preferredLocation: "", budget: null,
    occupation: "", comments: "", dateOfBirth: "", gender: "",
  },
  siteVisit: {
    required: true, date: "", time: "", projectId: "", visitorCount: 1, visitType: "",
    preferredLocation: "", transportRequired: false, comments: "",
  },
  company: {
    name: "", type: "", industry: "", email: "", phone: "", website: "", address: "", city: "",
    state: "", country: "", postalCode: "", designation: "", department: "", numberOfEmployees: null,
    gstNumber: "", comments: "",
  },
};

const industries = [
  "TECHNOLOGY", "HEALTHCARE", "FINANCE", "EDUCATION", "MANUFACTURING", "RETAIL",
  "REAL_ESTATE", "CONSTRUCTION", "HOSPITALITY", "AUTOMOTIVE", "ENERGY",
  "TELECOMMUNICATIONS", "MEDIA", "GOVERNMENT", "OTHER",
];

function SectionTitle({ title, description, icon: Icon }: { title: string; description: string; icon?: LucideIcon }) {
  return <div className="mb-4 border-b border-slate-200/80 pb-3"><div className="flex items-center gap-2.5">{Icon && <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-gradient-to-br from-blue-500 to-cyan-500 text-white shadow-sm"><Icon className="h-4 w-4" /></span>}<h2 className="text-base font-semibold tracking-tight text-slate-800">{title}</h2></div><p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{description}</p></div>;
}

function Field({ label, children, required = false }: { label: string; children: React.ReactNode; required?: boolean }) {
  return <div><Label className="space-y-1 text-[11px] font-medium"><span className="block text-teal-700">{label}{required && <span className="ml-1 text-destructive">*</span>}</span>{children}</Label></div>;
}

export function GreRegistrationPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [meta, setMeta] = React.useState<FormMeta | null>(null);
  const [draft, setDraft] = React.useState<Draft>(emptyDraft);
  const [countryCode, setCountryCode] = React.useState("+91");
  const [phone, setPhone] = React.useState("");
  const [alternatePhone, setAlternatePhone] = React.useState("");
  const [sessionToken, setSessionToken] = React.useState("");
  const [leadExists, setLeadExists] = React.useState(false);
  const [leadDetails, setLeadDetails] = React.useState<PublicLeadDetails | null>(null);
  const [referenceNumber, setReferenceNumber] = React.useState("");
  const [submittedLeadWasExisting, setSubmittedLeadWasExisting] = React.useState(false);
  const [submittedScheduledVisitWasCompleted, setSubmittedScheduledVisitWasCompleted] = React.useState(false);
  const [submittedAssignment, setSubmittedAssignment] = React.useState<{ assignedTo: string | null; warning?: string | null } | null>(null);
  const [submittedSiteVisit, setSubmittedSiteVisit] = React.useState<{ projectId: string; scheduledAt: string; status: string } | null>(null);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(true);
  const [isBusy, setIsBusy] = React.useState(false);

  React.useEffect(() => {
    if (!token) return;
    let isMounted = true;
    const restore = async () => {
      try {
        const response = await greApi.getPublicForm(token);
        if (!isMounted) return;
        const formMeta = response.data.data as FormMeta;
        setMeta(formMeta);
        setDraft({
          ...emptyDraft,
          lead: { ...emptyDraft.lead, projectId: formMeta.defaultProjectId || "" },
          siteVisit: { ...emptyDraft.siteVisit, projectId: formMeta.defaultProjectId || "" },
        });
        const savedToken = sessionStorage.getItem(`gre-session:${token}`);
        if (savedToken) {
          try {
            const sessionResponse = await greApi.getPublicSession(token, savedToken);
            if (!isMounted) return;
            const saved = sessionResponse.data.data;
            setSessionToken(savedToken);
            setLeadExists(Boolean(saved.leadExists));
            setLeadDetails(saved.leadDetails || null);
            setCountryCode(saved.countryCode || "+91");
            setPhone(saved.phone || "");
            if (saved.draft) setDraft((current) => ({
              ...current,
              ...saved.draft,
              lead: { ...current.lead, ...saved.draft.lead },
              siteVisit: { ...current.siteVisit, ...saved.draft.siteVisit, required: true },
            }));
            setAlternatePhone(saved.draft?.lead?.secondaryPhone || "");
          } catch (sessionError: any) {
            if (sessionError?.response?.status === 409 && sessionError?.response?.data?.referenceNumber) {
              setReferenceNumber(sessionError.response.data.referenceNumber);
              return;
            }
            sessionStorage.removeItem(`gre-session:${token}`);
            if (sessionError?.response?.status !== 401 && sessionError?.response?.status !== 410) throw sessionError;
          }
        }
      } catch (error: any) {
        if (isMounted) setErrorMessage(
          error?.response?.status === 429
            ? "This registration form is temporarily busy. Please wait a few minutes and try again."
            : error?.response?.data?.error || "This registration link is unavailable. Please contact the team that shared it.",
        );
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    void restore();
    return () => { isMounted = false; };
  }, [token]);

  const updateLead = <K extends keyof Draft["lead"]>(key: K, value: Draft["lead"][K]) =>
    setDraft((current) => ({ ...current, lead: { ...current.lead, [key]: value } }));
  const updateSiteVisit = <K extends keyof Draft["siteVisit"]>(key: K, value: Draft["siteVisit"][K]) =>
    setDraft((current) => ({ ...current, siteVisit: { ...current.siteVisit, [key]: value } }));
  const updateCompany = <K extends keyof Draft["company"]>(key: K, value: Draft["company"][K]) =>
    setDraft((current) => ({ ...current, company: { ...current.company, [key]: value } }));

  const startSession = async () => {
    setIsBusy(true);
    setErrorMessage("");
    try {
      const response = await greApi.startPublicSession(token, { countryCode, phone, alternatePhone });
      const data = response.data.data;
      setSessionToken(data.sessionToken);
      sessionStorage.setItem(`gre-session:${token}`, data.sessionToken);
      setLeadExists(Boolean(data.leadExists));
      setLeadDetails(data.leadDetails || null);
      setDraft({
        ...emptyDraft,
        lead: {
          ...emptyDraft.lead,
          secondaryPhone: data.alternatePhone || "",
          projectId: meta?.defaultProjectId || "",
        },
        siteVisit: { ...emptyDraft.siteVisit, projectId: meta?.defaultProjectId || "" },
      });
    } catch (error: any) {
      setErrorMessage(
        error?.response?.status === 429
          ? "Too many phone checks were made from this network. Please wait a few minutes and try again."
          : error?.response?.data?.error || "Unable to verify this phone number. Please try again.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const submit = async () => {
    setIsBusy(true);
    setErrorMessage("");
    try {
      const response = await greApi.submitPublicSession(token, sessionToken, draft);
      setReferenceNumber(response.data.data.referenceNumber);
      setSubmittedLeadWasExisting(Boolean(response.data.data.leadWasExisting));
      setSubmittedScheduledVisitWasCompleted(Boolean(response.data.data.scheduledVisitCompleted));
      setSubmittedAssignment(response.data.data.assignment || null);
      setSubmittedSiteVisit(response.data.data.siteVisit || null);
      sessionStorage.removeItem(`gre-session:${token}`);
      setSessionToken("");
    } catch (error: any) {
      if (error?.response?.status === 409 && error?.response?.data?.referenceNumber) {
        setReferenceNumber(error.response.data.referenceNumber);
        sessionStorage.removeItem(`gre-session:${token}`);
        setSessionToken("");
        return;
      }
      setErrorMessage(
        error?.response?.status === 429
          ? "This form is temporarily busy. Please wait a few minutes before submitting again."
          : error?.response?.data?.error || "Unable to submit your registration. Please try again.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const changePhoneNumber = () => {
    sessionStorage.removeItem(`gre-session:${token}`);
    setSessionToken("");
    setDraft({
      ...emptyDraft,
      lead: { ...emptyDraft.lead, projectId: meta?.defaultProjectId || "" },
      siteVisit: { ...emptyDraft.siteVisit, projectId: meta?.defaultProjectId || "" },
    });
    setAlternatePhone("");
    setLeadExists(false);
    setLeadDetails(null);
    setErrorMessage("");
  };

  const registerAnotherCustomer = () => {
    sessionStorage.removeItem(`gre-session:${token}`);
    setPhone("");
    setAlternatePhone("");
    setCountryCode("+91");
    setSessionToken("");
    setLeadExists(false);
    setLeadDetails(null);
    setReferenceNumber("");
    setSubmittedLeadWasExisting(false);
    setSubmittedScheduledVisitWasCompleted(false);
    setSubmittedAssignment(null);
    setSubmittedSiteVisit(null);
    setDraft({
      ...emptyDraft,
      lead: { ...emptyDraft.lead, projectId: meta?.defaultProjectId || "" },
      siteVisit: { ...emptyDraft.siteVisit, projectId: meta?.defaultProjectId || "" },
    });
    setErrorMessage("");
  };

  const scheduledVisitForSelectedProject = leadDetails?.siteVisits.find((visit) =>
    visit.projectId === draft.siteVisit.projectId && visit.status === "SCHEDULED",
  );

  if (isLoading) return <CenteredState><Loader2 className="h-6 w-6 animate-spin text-primary" /><span className="sr-only">Loading registration form</span></CenteredState>;
  if (errorMessage && !meta) return <CenteredState><StateCard><AlertCircle className="mx-auto h-8 w-8 text-destructive" /><h1 className="mt-4 text-lg font-semibold">Registration link unavailable</h1><p className="mt-2 text-sm text-muted-foreground">{errorMessage}</p></StateCard></CenteredState>;
  if (referenceNumber) return <CenteredState><StateCard><CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" /><h1 className="mt-4 text-xl font-semibold">Site visit registered</h1><p className="mt-2 text-sm text-muted-foreground">{submittedScheduledVisitWasCompleted ? "Your scheduled Site Visit was marked completed." : submittedLeadWasExisting ? "Your existing Lead was updated and the new visit was added." : "Your Lead and Site Visit were created."} The Lead status is now Site Visit Happened.</p>{submittedAssignment?.assignedTo && <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Assigned to Sales: <span className="font-semibold">{submittedAssignment.assignedTo}</span></p>}{submittedAssignment?.warning && <p role="status" className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-left text-sm text-amber-900">{submittedAssignment.warning} Please contact the CRM team to complete the assignment.</p>}{submittedSiteVisit && <div className="mt-4 rounded-md border p-3 text-left text-sm"><p><span className="font-medium">Project:</span> {meta?.projects.find((project) => project.id === submittedSiteVisit.projectId)?.name || "Selected project"}</p><p className="mt-1"><span className="font-medium">Visit:</span> {new Date(submittedSiteVisit.scheduledAt).toLocaleString()}</p><p className="mt-1"><span className="font-medium">Status:</span> {submittedSiteVisit.status}</p></div>}<p className="mt-5 rounded-md bg-muted px-4 py-3 font-mono text-sm">{referenceNumber}</p><p className="mt-3 text-xs text-muted-foreground">Please keep this reference number for your records.</p><Button type="button" className="mt-5 w-full" onClick={registerAnotherCustomer}>Register another customer</Button></StateCard></CenteredState>;

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-100 px-4 py-6 sm:py-10">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-20 top-[28%] h-72 w-72 rounded-full bg-cyan-200/50 blur-3xl" />
        <div className="absolute right-[-5rem] top-10 h-80 w-80 rounded-full bg-indigo-200/45 blur-3xl" />
        <div className="absolute bottom-[-7rem] left-[35%] h-80 w-80 rounded-full bg-pink-200/40 blur-3xl" />
      </div>
      <div className="relative z-10 mx-auto max-w-md">
        {!sessionToken ? <header className="mb-6 rounded-xl border border-blue-500/20 bg-gradient-to-r from-indigo-700 via-blue-700 to-cyan-600 px-5 py-5 text-white shadow-lg shadow-blue-900/10 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-white/20 bg-white/10 p-2.5 text-white"><ShieldCheck className="h-5 w-5" /></div>
            <div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wide text-white/75">{meta?.tenantName}</p><h1 className="truncate text-lg font-semibold">{meta?.formName || "General Registration Enquiry"}</h1></div>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-white/80">Register a customer and record a completed Site Visit in one step.</p>
        </header> : <div className="mb-3 flex items-center justify-between">
          <button type="button" onClick={changePhoneNumber} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-white/70 hover:text-blue-700">
            <ArrowLeft className="h-3.5 w-3.5" />Back
          </button>
          <span className="text-xs font-medium text-slate-500">{meta?.tenantName}</span>
        </div>}

        {!sessionToken && <section className="mb-4 rounded-xl border border-blue-100 bg-gradient-to-br from-white via-blue-50/70 to-indigo-50/80 px-5 py-7 shadow-md shadow-blue-900/5 sm:px-8 sm:py-9">
            <div className="mx-auto max-w-xl text-center">
              <h2 className="bg-gradient-to-r from-indigo-700 via-blue-700 to-cyan-700 bg-clip-text text-2xl font-semibold tracking-tight text-transparent">Welcome</h2>
              <p className="mt-2 text-sm text-muted-foreground">Please enter your mobile number to proceed with the registration.</p>
            </div>
            <div className="mx-auto mt-7 max-w-xl space-y-5">
              <div className="grid grid-cols-[110px_1fr] gap-3">
                <Field label="Country code">
                  <select disabled={Boolean(sessionToken)} value={countryCode} onChange={(event) => setCountryCode(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option value="+91">India +91</option><option value="+1">US/Canada +1</option><option value="+44">UK +44</option><option value="+61">Australia +61</option><option value="+65">Singapore +65</option><option value="+971">UAE +971</option>
                  </select>
                </Field>
                <Field label="Mobile number" required><Input disabled={Boolean(sessionToken)} type="tel" autoComplete="tel-national" inputMode="tel" required minLength={7} maxLength={20} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Enter mobile number" /></Field>
              </div>
              <Field label="Alternate mobile number"><Input disabled={Boolean(sessionToken)} type="tel" autoComplete="tel-national" inputMode="tel" maxLength={30} value={sessionToken ? (leadExists ? leadDetails?.secondaryPhone || leadDetails?.tertiaryPhone || "" : draft.lead.secondaryPhone) : alternatePhone} onChange={(event) => setAlternatePhone(event.target.value)} placeholder="Enter alternate mobile number (optional)" /></Field>
              {!sessionToken && <Button type="button" className="h-11 w-full bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-600 text-base text-white shadow-md shadow-blue-600/20 transition hover:from-indigo-700 hover:via-blue-700 hover:to-cyan-700" disabled={isBusy || !phone.trim()} onClick={() => void startSession()}>{isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Proceed</Button>}
              {sessionToken && <Button type="button" variant="outline" disabled={isBusy} onClick={changePhoneNumber}>Change phone number</Button>}
              {errorMessage && !sessionToken && <ErrorNotice message={errorMessage} />}
              <p className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">Phone ownership is not verified by SMS. If a number matches an existing Lead, its details will be shown here and used for this enquiry.</p>
            </div>
        </section>}

        {sessionToken && (
          <>
            {leadExists && leadDetails && <section className="mb-3 rounded-xl border border-white/90 bg-white/90 p-4 shadow-md shadow-slate-900/5 backdrop-blur-sm">
              <div className="mb-3 flex items-center gap-2 border-b border-slate-100 pb-2">
                <span className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-amber-400 to-orange-500 text-white"><FileText className="h-3.5 w-3.5" /></span>
                <h2 className="text-xs font-semibold text-slate-800">Existing Lead Details</h2>
                <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">{leadDetails.status.replaceAll("_", " ")}</span>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <ReviewRow label="Customer" value={[leadDetails.title, leadDetails.firstName, leadDetails.lastName].filter(Boolean).join(" ")} />
                <ReviewRow label="Lead ID" value={leadDetails.leadNumber || "CRM record"} />
                <ReviewRow label="Phone" value={leadDetails.phone || leadDetails.mobile || phone} />
                <ReviewRow label="Alternate mobile" value={leadDetails.secondaryPhone || leadDetails.tertiaryPhone} />
                <ReviewRow label="Email" value={leadDetails.email} />
                <ReviewRow label="Current project" value={leadDetails.project?.name} />
                <ReviewRow label="Company" value={leadDetails.company} />
                <ReviewRow label="Budget" value={leadDetails.budget == null ? null : `₹${leadDetails.budget.toLocaleString()}`} />
                <ReviewRow label="Preferred location" value={leadDetails.preferredLocation} />
                <ReviewRow label="Industry" value={leadDetails.industry?.replaceAll("_", " ")} />
                <ReviewRow label="Requirements" value={leadDetails.requirements} />
                <ReviewRow label="Campaign" value={leadDetails.campaign} />
              </dl>
              {leadDetails.companyAccount && <p className="mt-2 border-t border-slate-100 pt-2 text-[11px] text-slate-500">Company account: {leadDetails.companyAccount.name} · {[leadDetails.companyAccount.city, leadDetails.companyAccount.state, leadDetails.companyAccount.country].filter(Boolean).join(", ") || "Location not set"}</p>}
              <p className="mt-2 text-[10px] leading-relaxed text-slate-500">Matched by phone. Saved Lead details will remain unchanged. If this project has a scheduled Site Visit, it will be completed in place; otherwise, a visit will be added.</p>
            </section>}
            {errorMessage && <div className="mb-4"><ErrorNotice message={errorMessage} /></div>}

            <section className="overflow-hidden rounded-xl border border-white/90 border-t-2 border-t-cyan-500 bg-white/95 p-4 shadow-xl shadow-slate-900/10 backdrop-blur-sm sm:p-5">
              <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
              <div className="space-y-5">
                {!leadExists && <>
                  <section>
                    <SectionTitle title="Personal Information" description="Your contact details" icon={UserRound} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="First name"><Input autoComplete="given-name" maxLength={100} value={draft.lead.firstName} onChange={(event) => updateLead("firstName", event.target.value)} /></Field>
                      <Field label="Last name" required><Input autoComplete="family-name" required maxLength={100} value={draft.lead.lastName} onChange={(event) => updateLead("lastName", event.target.value)} /></Field>
                      <Field label="Mobile number"><Input value={`${countryCode} ${phone}`} readOnly aria-readonly="true" /></Field>
                      <Field label="Alternate mobile"><Input value={draft.lead.secondaryPhone} readOnly aria-readonly="true" /></Field>
                      <Field label="Email"><Input type="email" autoComplete="email" maxLength={254} value={draft.lead.email} onChange={(event) => updateLead("email", event.target.value)} /></Field>
                      <Field label="Alternate email"><Input type="email" maxLength={254} value={draft.lead.alternateEmail} onChange={(event) => updateLead("alternateEmail", event.target.value)} /></Field>
                      <Field label="Date of birth"><Input type="date" value={draft.lead.dateOfBirth} onChange={(event) => updateLead("dateOfBirth", event.target.value)} /></Field>
                      <Field label="Gender"><select value={draft.lead.gender} onChange={(event) => updateLead("gender", event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Select (optional)</option><option>Female</option><option>Male</option><option>Non-binary</option><option>Prefer not to say</option></select></Field>
                    </div>
                  </section>
                  <section>
                    <SectionTitle title="Professional Information" description="Occupation and customer preferences" icon={Briefcase} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Occupation"><Input maxLength={150} value={draft.lead.occupation} onChange={(event) => updateLead("occupation", event.target.value)} /></Field>
                      <Field label="Budget"><Input type="number" min="0" step="any" value={draft.lead.budget ?? ""} onChange={(event) => updateLead("budget", event.target.value === "" ? null : Number(event.target.value))} /></Field>
                      <Field label="Preferred location"><Input maxLength={150} value={draft.lead.preferredLocation} onChange={(event) => updateLead("preferredLocation", event.target.value)} /></Field>
                      <Field label="Lead type"><Input maxLength={100} value={draft.lead.leadType} onChange={(event) => updateLead("leadType", event.target.value)} /></Field>
                    </div>
                  </section>
                </>}
              </div>

              <div className="space-y-4 border-t border-slate-100 pt-5">
                <SectionTitle title="Property Requirement & Site Visit" description="Choose a project and enter the completed visit details." icon={Home} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Project" required><select required value={draft.siteVisit.projectId} onChange={(event) => updateSiteVisit("projectId", event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Select a project</option>{meta?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field>
                  {scheduledVisitForSelectedProject && <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 sm:col-span-2">Scheduled Site Visit found for {new Date(scheduledVisitForSelectedProject.scheduledAt).toLocaleString()}. Submitting this GRE will mark that scheduled visit as completed instead of creating a duplicate.</p>}
                  {leadExists && leadDetails?.siteVisits?.some((visit) => visit.projectId === draft.siteVisit.projectId) && <p className="text-xs font-medium text-blue-700 sm:col-span-2">Revisit — this Lead has visited this project before.</p>}
                  <Field label="Visit date" required><Input type="date" required max={new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)} value={draft.siteVisit.date} onChange={(event) => updateSiteVisit("date", event.target.value)} /></Field>
                  <Field label="Visit time" required><Input type="time" required value={draft.siteVisit.time} onChange={(event) => updateSiteVisit("time", event.target.value)} /></Field>
                  <Field label="Number of visitors"><Input type="number" min={1} max={50} value={draft.siteVisit.visitorCount ?? 1} onChange={(event) => updateSiteVisit("visitorCount", event.target.value === "" ? null : Number(event.target.value))} /></Field>
                  <Field label="Visit type">{leadExists && leadDetails?.siteVisits?.some((visit) => visit.projectId === draft.siteVisit.projectId) ? <Input value="Revisit" readOnly aria-readonly="true" /> : <Input maxLength={100} value={draft.siteVisit.visitType} onChange={(event) => updateSiteVisit("visitType", event.target.value)} placeholder="Personal visit, family visit…" />}</Field>
                  <Field label="Location"><Input maxLength={150} value={draft.siteVisit.preferredLocation} onChange={(event) => updateSiteVisit("preferredLocation", event.target.value)} /></Field>
                  <Field label="Transport required"><select value={String(draft.siteVisit.transportRequired ?? false)} onChange={(event) => updateSiteVisit("transportRequired", event.target.value === "true")} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="false">No</option><option value="true">Yes</option></select></Field>
                  <div className="sm:col-span-2"><Field label="Notes for the visit"><Textarea rows={3} maxLength={2000} value={draft.siteVisit.comments} onChange={(event) => updateSiteVisit("comments", event.target.value)} /></Field></div>
                </div>
              </div>

              <div className="space-y-4 border-t border-slate-100 pt-5">
                <SectionTitle title="Brand & Enquiry Information" description="Tell us how you heard about us and share any extra details." icon={Building2} />
                {leadExists
                  ? <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">Existing Lead and company information will remain unchanged.</p>
                  : <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Campaign"><Input maxLength={150} value={draft.lead.campaign} onChange={(event) => updateLead("campaign", event.target.value)} /></Field>
                    <Field label="Lead source"><Input maxLength={100} value={draft.lead.leadSubSource} onChange={(event) => updateLead("leadSubSource", event.target.value)} /></Field>
                  </div>}
                {!leadExists && <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Company name"><Input maxLength={200} value={draft.company.name} onChange={(event) => updateCompany("name", event.target.value)} /></Field>
                  <Field label="Company type"><Input maxLength={100} value={draft.company.type} onChange={(event) => updateCompany("type", event.target.value)} /></Field>
                  <Field label="Company email"><Input type="email" maxLength={254} value={draft.company.email} onChange={(event) => updateCompany("email", event.target.value)} /></Field>
                  <Field label="Company phone"><Input type="tel" maxLength={30} value={draft.company.phone} onChange={(event) => updateCompany("phone", event.target.value)} /></Field>
                  <Field label="Website"><Input type="url" maxLength={500} placeholder="https://" value={draft.company.website} onChange={(event) => updateCompany("website", event.target.value)} /></Field>
                  <Field label="City"><Input maxLength={100} value={draft.company.city} onChange={(event) => updateCompany("city", event.target.value)} /></Field>
                  <Field label="Industry"><select value={draft.company.industry} onChange={(event) => updateCompany("industry", event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Select industry</option>{industries.map((industry) => <option key={industry} value={industry}>{industry.replaceAll("_", " ")}</option>)}</select></Field>
                </div>}
                {!leadExists && <Field label="Enquiry / customer notes"><Textarea rows={3} maxLength={5000} value={draft.lead.comments} onChange={(event) => updateLead("comments", event.target.value)} /></Field>}
                <p className="rounded-md bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">By submitting, you confirm that the information provided is accurate and may be used by {meta?.tenantName} to contact you about your enquiry.</p>
              </div>

              <div className="mt-7 border-t pt-5">
                {errorMessage && <div className="mb-4"><ErrorNotice message={errorMessage} /></div>}
                <Button type="submit" className="w-full bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-600 text-white shadow-md shadow-blue-600/20 transition hover:from-indigo-700 hover:via-blue-700 hover:to-cyan-700 sm:w-auto" disabled={isBusy || !draft.siteVisit.projectId || !draft.siteVisit.date || !draft.siteVisit.time || (!leadExists && !draft.lead.lastName.trim())}>
                  {isBusy && <Loader2 className="h-4 w-4 animate-spin" />}Submit GRE
                </Button>
              </div>
              </form>
            </section>
            <p className="mt-4 text-center text-xs text-muted-foreground">Secure registration · {meta?.tenantName}</p>
          </>
        )}
      </div>
    </main>
  );
}

function ReviewRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return <div><dt className="text-[9px] font-medium uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-0.5 break-words text-[11px] font-medium text-slate-800">{value}</dd></div>;
}

function ErrorNotice({ message }: { message: string }) {
  return <div role="alert" className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{message}</span></div>;
}

function StateCard({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-md rounded-xl border bg-card p-7 text-center shadow-sm sm:p-9">{children}</div>;
}

function CenteredState({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4"><div className="flex flex-col items-center">{children}</div></main>;
}
