"use client";

import { formatDate, formatDateTime } from "@/lib/date-format";
import { crmLocalDateTimeToDate } from "@dct-crm/shared";

import * as React from "react";

import { useParams, useRouter } from "next/navigation";

import { useAuth } from "@/contexts/auth-context";

import { leadApi, siteVisitApi, opportunityApi, activityApi, taskApi, followUpApi, objectManagerApi, projectApi, unitApi, quotationApi, bookingApi } from "@/lib/api";
import { getCurrentCoordinates } from "@/lib/geolocation";

import LayoutDrivenForm from "@/components/admin/layout-driven-form";

import { useToast } from "@/hooks/use-toast";

import { Badge } from "@/components/ui/badge";

import { Button } from "@/components/ui/button";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { Separator } from "@/components/ui/separator";

import { Skeleton } from "@/components/ui/skeleton";

import { Textarea } from "@/components/ui/textarea";

import { Input } from "@/components/ui/input";

import { Label } from "@/components/ui/label";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  User,
  Phone,
  Mail,
  MapPin,
  Calendar,
  FileText,
  CheckSquare,
  Clock,
  Map,
  TrendingUp,
  History,
  Inbox,
  ArrowLeft,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  StickyNote,
  Edit3,
  Save,
  X,
} from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  INCOMING: "Incoming",
  PROSPECT: "Prospect",
  SITE_VISIT_SCHEDULED: "Site Visit Scheduled",
  SITE_VISIT_HAPPENED: "Site Visit Happened",
  BOOKED: "Booked",
  LOST: "Lost",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info"> = {
  NEW: "info",
  INCOMING: "info",
  PROSPECT: "warning",
  SITE_VISIT_SCHEDULED: "warning",
  SITE_VISIT_HAPPENED: "success",
  BOOKED: "success",
  LOST: "destructive",
};

const RECOVERY_REASONS = [
  "Not Interested",
  "Budget Issue",
  "No Response",
  "Property Not Suitable",
  "Customer Request",
  "Other",
];

const LEAD_STATUS_PROGRESSION = [
  { key: "NEW", label: "New" },
  { key: "INCOMING", label: "Incoming" },
  { key: "PROSPECT", label: "Prospect" },
  { key: "SITE_VISIT_SCHEDULED", label: "Site Visit Scheduled" },
  { key: "SITE_VISIT_HAPPENED", label: "Site Visit Happened" },
  { key: "BOOKED", label: "Booked" },
  { key: "LOST", label: "Lost" },
];

interface LeadData {
  id: string;
  leadNumber: string;
  salutation?: string;
  firstName?: string;
  lastName: string;
  title?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  website?: string;
  company: string;
  industry?: string;
  annualRevenue?: number;
  numberOfEmployees?: number;
  source: string;
  status: string;
  rating?: string;
  description?: string;
  score?: number;
  budget?: number;
  street?: string;
  city?: string;
  stateProvince?: string;
  country?: string;
  postalCode?: string;
  requirements?: string;
  notes?: string;
  owner?: { id: string; firstName: string; lastName: string };
  creator?: { id: string; firstName: string; lastName: string };
  project?: { id: string; name: string };
  projectId?: string | null;
  siteVisits?: any[];
  opportunities?: any[];
  activities?: any[];
  tasks?: any[];
  followUps?: any[];
  auditLogs?: any[];
  ownerHistory?: any[];
  lastModified?: {
    by?: { id: string; firstName: string; lastName: string; email?: string | null } | null;
    at?: string;
    action?: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface LeadEnquiry {
  id: string;
  enquiryNumber: string;
  enquiryType: string;
  source: string;
  subSource?: string | null;
  project?: { id: string; name: string } | null;
  enquiryDate: string;
  createdAt: string;
}

const LEAD_EDITABLE_FIELDS = [
  "salutation",
  "firstName",
  "lastName",
  "title",
  "email",
  "phone",
  "mobile",
  "website",
  "company",
  "industry",
  "annualRevenue",
  "numberOfEmployees",
  "source",
  "status",
  "rating",
  "description",
  "score",
  "budget",
  "street",
  "city",
  "stateProvince",
  "country",
  "postalCode",
  "requirements",
  "notes",
  "projectId",
] as const;

export default function LeadDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { profile, user, isLoading: authLoading, hasPermission, hasEffectivePermission, isAdmin, isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const leadId = params.id as string;

  const [lead, setLead] = React.useState<LeadData | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isActionLoading, setIsActionLoading] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState("overview");
  const [recoveryDialogOpen, setRecoveryDialogOpen] = React.useState(false);
  const [recoveryReason, setRecoveryReason] = React.useState("");
  const [recoveryNote, setRecoveryNote] = React.useState("");
  const [layout, setLayout] = React.useState<any>(null);
  const [fields, setFields] = React.useState<any[]>([]);

  const [followUpDialogOpen, setFollowUpDialogOpen] = React.useState(false);
  const [followUpNote, setFollowUpNote] = React.useState("");
  const [followUpDate, setFollowUpDate] = React.useState("");
  const [followUpTime, setFollowUpTime] = React.useState("");

  const [taskDialogOpen, setTaskDialogOpen] = React.useState(false);
  const [taskNote, setTaskNote] = React.useState("");
  const [taskDueDate, setTaskDueDate] = React.useState("");
  const [taskTime, setTaskTime] = React.useState("");

  const [siteVisitDialogOpen, setSiteVisitDialogOpen] = React.useState(false);
  const [svProjectId, setSvProjectId] = React.useState("");
  const [svNote, setSvNote] = React.useState("");
  const [svDate, setSvDate] = React.useState("");
  const [svTime, setSvTime] = React.useState("");
  const [projects, setProjects] = React.useState<any[]>([]);
  const [projectsLoading, setProjectsLoading] = React.useState(false);
  const [projectsError, setProjectsError] = React.useState<string | null>(null);
  const projectsLoaded = React.useRef(false);
  const projectsRequest = React.useRef<Promise<void> | null>(null);

  const [noteDialogOpen, setNoteDialogOpen] = React.useState(false);
  const [noteContent, setNoteContent] = React.useState("");
  const [noteSubject, setNoteSubject] = React.useState("");

  const [pushSvcDialogOpen, setPushSvcDialogOpen] = React.useState(false);
  const [pushSvcReason, setPushSvcReason] = React.useState("");

  const [auditLogs, setAuditLogs] = React.useState<any[]>([]);
  const [auditPage, setAuditPage] = React.useState(1);
  const [auditTotalPages, setAuditTotalPages] = React.useState(1);
  const [auditTotal, setAuditTotal] = React.useState(0);
  const [auditLoading, setAuditLoading] = React.useState(false);
  const [enquiries, setEnquiries] = React.useState<LeadEnquiry[]>([]);
  const [enquiriesLoading, setEnquiriesLoading] = React.useState(false);
  const [enquiriesError, setEnquiriesError] = React.useState<string | null>(null);

  const [isEditing, setIsEditing] = React.useState(false);
  const [editData, setEditData] = React.useState<Record<string, any>>({});
  const [editFieldErrors, setEditFieldErrors] = React.useState<Record<string, string>>({});
  const [editReason, setEditReason] = React.useState("");

  const [revisitDialogOpen, setRevisitDialogOpen] = React.useState(false);
  const [revisitReason, setRevisitReason] = React.useState("");
  const [revisitDate, setRevisitDate] = React.useState("");
  const [revisitTime, setRevisitTime] = React.useState("");
  const [revisitProjectId, setRevisitProjectId] = React.useState("");
  const [revisitNote, setRevisitNote] = React.useState("");

  const [cancelSvDialogOpen, setCancelSvDialogOpen] = React.useState(false);
  const [cancelSvReason, setCancelSvReason] = React.useState("");

  const [completeSvDialogOpen, setCompleteSvDialogOpen] = React.useState(false);
  const [locationConsentOpen, setLocationConsentOpen] = React.useState(false);
  const [completeSvFeedback, setCompleteSvFeedback] = React.useState("");
  const [completeSvNotes, setCompleteSvNotes] = React.useState("");
  const [completeSvTime, setCompleteSvTime] = React.useState("");
  const [completeSvRating, setCompleteSvRating] = React.useState("");

  const [detailDialogOpen, setDetailDialogOpen] = React.useState(false);
  const [detailItem, setDetailItem] = React.useState<{ kind: "task" | "followup" | "note" | "activity"; data: any } | null>(null);

  const [createOppDialogOpen, setCreateOppDialogOpen] = React.useState(false);
  const [oppName, setOppName] = React.useState("");
  const [oppAmount, setOppAmount] = React.useState("");
  const [oppDescription, setOppDescription] = React.useState("");
  const [oppProjectId, setOppProjectId] = React.useState("");
  const [oppUnitId, setOppUnitId] = React.useState("");
  const [oppUnits, setOppUnits] = React.useState<any[]>([]);
  const [oppUnitsLoading, setOppUnitsLoading] = React.useState(false);
  const [oppUnitsError, setOppUnitsError] = React.useState<string | null>(null);

  const [createQuoteDialogOpen, setCreateQuoteDialogOpen] = React.useState(false);
  const [quoteDescription, setQuoteDescription] = React.useState("");
  const [quoteUnitPrice, setQuoteUnitPrice] = React.useState("");

  const [createBookingDialogOpen, setCreateBookingDialogOpen] = React.useState(false);
  const [bookingProjectId, setBookingProjectId] = React.useState("");
  const [bookingUnitId, setBookingUnitId] = React.useState("");
  const [bookingUnits, setBookingUnits] = React.useState<any[]>([]);
  const [bookingUnitsLoading, setBookingUnitsLoading] = React.useState(false);
  const [bookingUnitsError, setBookingUnitsError] = React.useState<string | null>(null);
  const [bookingAmount, setBookingAmount] = React.useState("");
  const [ownerDialogOpen, setOwnerDialogOpen] = React.useState(false);
  const [ownerCandidates, setOwnerCandidates] = React.useState<any[]>([]);
  const [newOwnerId, setNewOwnerId] = React.useState("");
  const [ownerChangeReason, setOwnerChangeReason] = React.useState("");

  const fetchLead = React.useCallback(async () => {
    try {
      setIsLoading(true);
      const [leadResult, layoutResult, fieldsResult] = await Promise.allSettled([
        leadApi.get(leadId),
        objectManagerApi.getDefaultLayout("Lead"),
        objectManagerApi.listFields("Lead", { includeSystem: true }),
      ]);

      if (leadResult.status === "fulfilled" && leadResult.value.data?.success && leadResult.value.data.data) {
        setLoadError(null);
        setLead(leadResult.value.data.data);
      } else {
        const errorMessage = leadResult.status === "rejected"
          ? "Failed to load lead"
          : leadResult.value?.data?.error || "Lead not found";
        setLead(null);
        setLoadError(errorMessage);
        toast({ title: "Error", description: errorMessage, variant: "destructive" as any });
      }

      if (layoutResult.status === "fulfilled") {
        setLayout(layoutResult.value.data?.data ?? null);
      }

      if (fieldsResult.status === "fulfilled") {
        setFields(fieldsResult.value.data?.data || []);
      }
    } catch {
      setLead(null);
      setLoadError("Failed to load lead");
      toast({ title: "Error", description: "Failed to load lead", variant: "destructive" as any });
    } finally {
      setIsLoading(false);
    }
  }, [leadId, toast]);

  const fetchAuditHistory = React.useCallback(
    async (page = 1) => {
      setAuditLoading(true);
      try {
        const res = await leadApi.getAuditHistory(leadId, { page, limit: 20 });
        if (res.data.success) {
          setAuditLogs(res.data.data || []);
          const p = res.data.pagination;
          setAuditPage(p?.page || page);
          setAuditTotalPages(p?.totalPages || 1);
          setAuditTotal(p?.total || 0);
        }
      } catch {
        toast({
          title: "Error",
          description: "Failed to load audit history",
          variant: "destructive" as any,
        });
      } finally {
        setAuditLoading(false);
      }
    },
    [leadId, toast],
  );

  const fetchEnquiries = React.useCallback(async () => {
    setEnquiriesLoading(true);
    setEnquiriesError(null);
    try {
      const response = await leadApi.getEnquiries(leadId, { page: 1, limit: 100 });
      if (!response.data.success) {
        throw new Error(response.data.error || "Failed to load enquiries");
      }
      setEnquiries(response.data.data || []);
    } catch (error: any) {
      setEnquiriesError(error?.response?.data?.error || error?.message || "Failed to load enquiries.");
    } finally {
      setEnquiriesLoading(false);
    }
  }, [leadId]);

  const loadProjects = React.useCallback((force = false) => {
    if (!force && projectsLoaded.current) return Promise.resolve();
    if (projectsRequest.current) return projectsRequest.current;

    setProjectsLoading(true);
    setProjectsError(null);
    const request = projectApi.listAll({ isActive: true })
      .then((projectList) => {
        const seenProjectIds = new globalThis.Set<string>();
        const uniqueProjects = projectList.filter((project: { id: string }) => {
          if (seenProjectIds.has(project.id)) return false;
          seenProjectIds.add(project.id);
          return true;
        });
        setProjects(uniqueProjects);
        projectsLoaded.current = true;
      })
      .catch((error: any) => {
        console.error("Failed to load projects for Lead workflow:", error);
        setProjectsError(
          error?.response?.data?.error || error?.message || "Failed to load projects. Please try again.",
        );
      })
      .finally(() => {
        projectsRequest.current = null;
        setProjectsLoading(false);
      });
    projectsRequest.current = request;
    return request;
  }, []);

  React.useEffect(() => {
    fetchLead();
  }, [fetchLead]);

  React.useEffect(() => {
    if (activeTab === "audit-history" && auditLogs.length === 0 && !auditLoading) {
      fetchAuditHistory(1);
    }
  }, [activeTab, auditLogs.length, auditLoading, fetchAuditHistory]);

  React.useEffect(() => {
    if (activeTab === "enquiries") {
      void fetchEnquiries();
    }
  }, [activeTab, fetchEnquiries]);

  React.useEffect(() => {
    if (siteVisitDialogOpen || revisitDialogOpen || createBookingDialogOpen || createOppDialogOpen) {
      void loadProjects();
    }
  }, [siteVisitDialogOpen, revisitDialogOpen, createBookingDialogOpen, createOppDialogOpen, loadProjects]);

  React.useEffect(() => {
    if (!createOppDialogOpen || !oppProjectId) {
      setOppUnits([]);
      setOppUnitId("");
      setOppUnitsError(null);
      return;
    }

    let cancelled = false;
    setOppUnitsLoading(true);
    setOppUnitsError(null);
    unitApi.list({ projectId: oppProjectId, status: "AVAILABLE", limit: 100 }).then((res) => {
      if (!cancelled) {
        setOppUnits(res.data.data || []);
      }
    }).catch((err) => {
      if (!cancelled) {
        setOppUnits([]);
        setOppUnitsError(err?.response?.data?.error || "Failed to load available units");
        toast({
          title: "Error",
          description: err?.response?.data?.error || "Failed to load available units",
          variant: "destructive" as any,
        });
      }
    }).finally(() => {
      if (!cancelled) setOppUnitsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [createOppDialogOpen, oppProjectId, toast]);

  React.useEffect(() => {
    if (!createBookingDialogOpen || !bookingProjectId) {
      setBookingUnits([]);
      setBookingUnitId("");
      setBookingUnitsError(null);
      return;
    }

    let cancelled = false;
    setBookingUnitsLoading(true);
    setBookingUnitsError(null);
    unitApi.list({ projectId: bookingProjectId, status: "AVAILABLE", limit: 100 }).then((res) => {
      if (!cancelled) setBookingUnits(res.data.data || []);
    }).catch((err) => {
      if (!cancelled) {
        setBookingUnits([]);
        setBookingUnitsError(err?.response?.data?.error || "Failed to load available units");
        toast({
          title: "Error",
          description: err?.response?.data?.error || "Failed to load available units",
          variant: "destructive" as any,
        });
      }
    }).finally(() => {
      if (!cancelled) setBookingUnitsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [createBookingDialogOpen, bookingProjectId, toast]);

  const profileNameLower = profile?.name?.toLowerCase() || "";
  const isAdminOrManager = profileNameLower.includes("admin") || profileNameLower.includes("manager");
  const canEditLead =
    hasPermission("Lead", "edit") ||
    hasEffectivePermission("LEAD_UPDATE") ||
    hasEffectivePermission("FULL_SYSTEM_ACCESS") ||
    isAdminOrManager;
  const canChangeOwner = hasEffectivePermission("LEAD_ASSIGN");

  const status = lead?.status || "";

  const openOwnerDialog = async () => {
    if (!lead) return;
    setIsActionLoading(true);
    try {
      const response = await leadApi.ownerCandidates(lead.id);
      setOwnerCandidates(response.data.data || []);
      setNewOwnerId("");
      setOwnerChangeReason("");
      setOwnerDialogOpen(true);
    } catch (err: any) {
      toast({
        title: "Error",
        description: err?.response?.data?.error || "Failed to load eligible owners",
        variant: "destructive" as any,
      });
    } finally {
      setIsActionLoading(false);
    }
  };

  const changeOwner = async () => {
    if (!newOwnerId) {
      toast({ title: "Validation", description: "New owner is required", variant: "destructive" as any });
      return;
    }
    if (!ownerChangeReason.trim()) {
      toast({ title: "Validation", description: "Reason is required", variant: "destructive" as any });
      return;
    }
    setIsActionLoading(true);
    try {
      await leadApi.changeOwner(leadId, newOwnerId, ownerChangeReason.trim());
      setOwnerDialogOpen(false);
      toast({ title: "Success", description: "Lead owner changed successfully" });
      await fetchLead();
      if (activeTab === "audit-history") await fetchAuditHistory(1);
    } catch (err: any) {
      toast({
        title: "Error",
        description: err?.response?.data?.error || "Failed to change lead owner",
        variant: "destructive" as any,
      });
    } finally {
      setIsActionLoading(false);
    }
  };

  const startEdit = () => {
    if (!lead) return;
    const editableData: Record<string, any> = {};
    for (const field of LEAD_EDITABLE_FIELDS) {
      if (lead[field] !== undefined) editableData[field] = lead[field];
    }
    editableData.projectId = lead.projectId ?? lead.project?.id ?? null;
    setEditData(editableData);
    setEditFieldErrors({});
    setIsEditing(true);
    void loadProjects();
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditData({});
    setEditFieldErrors({});
    setEditReason("");
  };

  const saveEdit = async () => {
    if (!lead) return;
    setEditFieldErrors({});
    if (!editData.lastName?.trim()) {
      toast({ title: "Validation", description: "Last name is required", variant: "destructive" as any });
      return;
    }
    if (!editData.company?.trim()) {
      toast({ title: "Validation", description: "Company is required", variant: "destructive" as any });
      return;
    }
    if (!String(editData.phone ?? "").trim()) {
      setEditFieldErrors({ phone: "Phone number is required." });
      toast({ title: "Validation", description: "Phone number is required.", variant: "destructive" as any });
      return;
    }
    setIsActionLoading(true);
    try {
      const payload: Record<string, any> = {};
      for (const key of LEAD_EDITABLE_FIELDS) {
        const value = editData[key];
        if (value !== null && value !== undefined && value !== "") {
          payload[key] = value;
        }
      }
      if (editData.projectId === null) payload.projectId = null;
      if (payload.status === lead.status) delete payload.status;
      if (editReason.trim()) payload.reason = editReason.trim();
      await leadApi.update(leadId, payload);
      toast({ title: "Success", description: "Lead updated successfully" });
      setIsEditing(false);
      setEditData({});
      setEditFieldErrors({});
      setEditReason("");
      await fetchLead();
      if (activeTab === "audit-history") {
        fetchAuditHistory(1);
      }
    } catch (err: any) {
      const message =
        err?.response?.data?.error || err?.response?.data?.message || err?.message || "Failed to update lead";
      if (message === "Phone number already exists for another lead.") {
        setEditFieldErrors({ phone: message });
      }
      toast({ title: "Error", description: message, variant: "destructive" as any });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handlePushToSVC = async () => {
    if (!pushSvcReason.trim()) {
      toast({ title: "Validation", description: "A reason/note is required", variant: "destructive" as any });
      return;
    }
    setIsActionLoading(true);
    let updatedLead: LeadData;
    try {
      const response = await leadApi.pushToSVC(leadId, { reason: pushSvcReason });
      if (!response.data?.success || !response.data.data) {
        throw new Error(response.data?.error || response.data?.message || "Push to SVC failed");
      }
      updatedLead = response.data.data;
    } catch (err: any) {
      toast({
        title: "Error",
        description: err?.response?.data?.error || err?.message || "Push to SVC failed",
        variant: "destructive" as any,
      });
      setIsActionLoading(false);
      return;
    }

    setLead((currentLead) => currentLead ? { ...currentLead, ...updatedLead } : updatedLead);
    toast({ title: "Success", description: "Lead pushed to SVC successfully." });
    setPushSvcDialogOpen(false);
    setPushSvcReason("");
    if (activeTab === "audit-history") {
      fetchAuditHistory(1);
    }
    setIsActionLoading(false);
  };

  const handleMoveToRecovery = async () => {
    if (!recoveryReason) {
      toast({ title: "Validation", description: "Please select a reason", variant: "destructive" as any });
      return;
    }
    setIsActionLoading(true);
    try {
      await leadApi.moveToRecovery(leadId, { recoveryReason, note: recoveryNote || undefined });
      toast({ title: "Success", description: "Lead moved to recovery" });
      setRecoveryDialogOpen(false);
      setRecoveryReason("");
      setRecoveryNote("");
      await fetchLead();
      if (activeTab === "audit-history") {
        fetchAuditHistory(1);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err?.response?.data?.error || "Failed to move to recovery", variant: "destructive" as any });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleScheduleSiteVisit = async () => {
    if (!svProjectId.trim()) {
      toast({ title: "Validation", description: "A project is required", variant: "destructive" as any });
      return;
    }
    if (!svNote.trim()) {
      toast({ title: "Validation", description: "Note/reason is required", variant: "destructive" as any });
      return;
    }
    if (!svDate || !svTime) {
      toast({ title: "Validation", description: "Visit date and time are required", variant: "destructive" as any });
      return;
    }
    setIsActionLoading(true);
    try {
      const scheduledAt = new Date(`${svDate}T${svTime}`).toISOString();
      const response = await leadApi.scheduleSiteVisit(leadId, { scheduledAt, notes: svNote, projectId: svProjectId });
      const result = response.data?.data;
      if (!response.data?.success || !result?.lead || !result?.siteVisit) {
        throw new Error(response.data?.error || response.data?.message || "Failed to schedule site visit");
      }
      setLead((currentLead) => ({
        ...(currentLead || result.lead),
        ...result.lead,
        siteVisits: [
          result.siteVisit,
          ...(currentLead?.siteVisits || []).filter((siteVisit: any) => siteVisit.id !== result.siteVisit.id),
        ],
      }));
      toast({ title: "Success", description: "Site visit scheduled successfully." });
      setSiteVisitDialogOpen(false);
      setSvNote("");
      setSvDate("");
      setSvTime("");
      setSvProjectId("");
      if (activeTab === "audit-history") {
        fetchAuditHistory(1);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err?.response?.data?.error || err?.message || "Failed to schedule site visit", variant: "destructive" as any });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleCreateFollowUp = async () => {
    if (!followUpNote.trim() || !followUpDate || !followUpTime) {
      toast({ title: "Validation", description: "Note, date, and time are all required", variant: "destructive" as any });
      return;
    }
    setIsActionLoading(true);
    try {
      const dueDate = new Date(`${followUpDate}T${followUpTime}`).toISOString();
      await followUpApi.create({ title: followUpNote, description: followUpNote, dueDate, leadId });
      toast({ title: "Success", description: "Follow-up created" });
      setFollowUpDialogOpen(false);
      setFollowUpNote("");
      setFollowUpDate("");
      setFollowUpTime("");
      await fetchLead();
      if (activeTab === "audit-history") {
        fetchAuditHistory(1);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err?.response?.data?.error || "Failed to create follow-up", variant: "destructive" as any });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleCreateTask = async () => {
    if (!taskNote.trim() || !taskDueDate || !taskTime) {
      toast({ title: "Validation", description: "Description, due date, and time are all required", variant: "destructive" as any });
      return;
    }
    setIsActionLoading(true);
    try {
      const dueDate = new Date(`${taskDueDate}T${taskTime}`).toISOString();
      await taskApi.create({ title: taskNote, description: taskNote, dueDate, leadId });
      toast({ title: "Success", description: "Task created" });
      setTaskDialogOpen(false);
      setTaskNote("");
      setTaskDueDate("");
      setTaskTime("");
      await fetchLead();
      if (activeTab === "audit-history") {
        fetchAuditHistory(1);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err?.response?.data?.error || "Failed to create task", variant: "destructive" as any });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleCreateNote = async () => {
    if (!noteContent.trim()) {
      toast({ title: "Validation", description: "Note content is required", variant: "destructive" as any });
      return;
    }
    setIsActionLoading(true);
    try {
      await activityApi.create({ type: "NOTE", subject: noteSubject || "Note", description: noteContent, leadId });
      toast({ title: "Success", description: "Note added" });
      setNoteDialogOpen(false);
      setNoteContent("");
      setNoteSubject("");
      await fetchLead();
      if (activeTab === "audit-history") {
        fetchAuditHistory(1);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err?.response?.data?.error || "Failed to add note", variant: "destructive" as any });
    } finally {
      setIsActionLoading(false);
    }
  };

  const getActiveSiteVisit = () => {
    const visits = lead?.siteVisits || [];
    return (
      visits.find((sv: any) => String(sv.status).toUpperCase() === "SCHEDULED") ||
      visits[0] ||
      null
    );
  };

  const handleRevisit = async () => {
    const activeSv = getActiveSiteVisit();
    if (!revisitReason.trim()) {
      toast({ title: "Validation", description: "A reason is required for revisit", variant: "destructive" as any });
      return;
    }
    if (!revisitDate || !revisitTime) {
      toast({ title: "Validation", description: "Visit date and time are required", variant: "destructive" as any });
      return;
    }
    if (!revisitProjectId) {
      toast({ title: "Validation", description: "Project is required", variant: "destructive" as any });
      return;
    }
    if (!activeSv) {
      toast({ title: "Error", description: "No site visit found to revisit", variant: "destructive" as any });
      return;
    }
    setIsActionLoading(true);
    try {
      const scheduledAt = crmLocalDateTimeToDate(revisitDate, revisitTime).toISOString();
      await siteVisitApi.revisit(activeSv.id, {
        reason: revisitReason.trim(),
        scheduledAt,
        projectId: revisitProjectId,
        notes: revisitNote || undefined,
      });
      toast({ title: "Success", description: "Revisit site visit created" });
      setRevisitDialogOpen(false);
      setRevisitReason("");
      setRevisitDate("");
      setRevisitTime("");
      setRevisitProjectId("");
      setRevisitNote("");
      await fetchLead();
      if (activeTab === "audit-history") {
        fetchAuditHistory(1);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err?.response?.data?.error || "Failed to create revisit", variant: "destructive" as any });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleCancelSiteVisit = async () => {
    const activeSv = getActiveSiteVisit();
    if (!cancelSvReason.trim()) {
      toast({ title: "Validation", description: "A reason is required to cancel", variant: "destructive" as any });
      return;
    }
    if (!activeSv) {
      toast({ title: "Error", description: "No scheduled site visit found", variant: "destructive" as any });
      return;
    }
    setIsActionLoading(true);
    try {
      await siteVisitApi.cancel(activeSv.id, cancelSvReason.trim());
      toast({ title: "Success", description: "Site visit cancelled" });
      setCancelSvDialogOpen(false);
      setCancelSvReason("");
      await fetchLead();
      if (activeTab === "audit-history") {
        fetchAuditHistory(1);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err?.response?.data?.error || "Failed to cancel site visit", variant: "destructive" as any });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleCompleteSiteVisit = () => {
    const activeSv = getActiveSiteVisit();
    if (!activeSv) {
      toast({ title: "Error", description: "No scheduled site visit found", variant: "destructive" as any });
      return;
    }
    if (!completeSvTime || !completeSvFeedback.trim() || !completeSvNotes.trim()) {
      toast({ title: "Validation", description: "Completion time, customer feedback, and notes are required", variant: "destructive" as any });
      return;
    }
    setLocationConsentOpen(true);
  };

  const handleConfirmLocationAndComplete = async () => {
    const activeSv = getActiveSiteVisit();
    if (!activeSv) {
      toast({ title: "Error", description: "No scheduled site visit found", variant: "destructive" as any });
      return;
    }
    if (!completeSvTime || !completeSvFeedback.trim() || !completeSvNotes.trim()) {
      toast({ title: "Validation", description: "Completion time, customer feedback, and notes are required", variant: "destructive" as any });
      return;
    }
    setIsActionLoading(true);
    try {
      const coordinates = await getCurrentCoordinates();
      const response = await siteVisitApi.complete(activeSv.id, {
        completedAt: crmLocalDateTimeToDate(completeSvTime.split("T")[0], completeSvTime.split("T")[1]).toISOString(),
        customerFeedback: completeSvFeedback.trim(),
        completionNotes: completeSvNotes.trim(),
        ...coordinates,
      });
      const result = response.data.data;
      setLead((current) => current ? {
        ...current,
        status: result.leadStatus || current.status,
        siteVisits: current.siteVisits?.map((visit: any) =>
          visit.id === activeSv.id ? { ...visit, ...result.siteVisit } : visit,
        ),
      } : current);
      setLocationConsentOpen(false);
      toast({ title: "Success", description: "Site visit marked as happened" });
      setCompleteSvDialogOpen(false);
      setCompleteSvFeedback("");
      setCompleteSvNotes("");
      setCompleteSvTime("");
      setCompleteSvRating("");
      if (activeTab === "audit-history") {
        fetchAuditHistory(1);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err?.response?.data?.error || err?.message || "Failed to complete site visit", variant: "destructive" as any });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleCreateOpportunity = async () => {
    if (!oppName.trim()) {
      toast({ title: "Validation", description: "Opportunity name is required", variant: "destructive" as any });
      return;
    }
    setIsActionLoading(true);
    try {
      const response = await leadApi.convert(leadId, {
        name: oppName.trim(),
        projectId: oppProjectId || undefined,
        unitId: oppUnitId || undefined,
        amount: oppAmount ? Number(oppAmount) : undefined,
        description: oppDescription || undefined,
      });
      const result = response.data.data;
      const oppNumber = result?.opportunity?.opportunityNumber;
      const ownerName = [result?.opportunity?.owner?.firstName, result?.opportunity?.owner?.lastName]
        .filter(Boolean)
        .join(" ");
      const fallbackNote = result?.ownerFallback ? " (Admin fallback)" : "";
      setLead((current) => current ? {
        ...current,
        ...(result?.lead || {}),
        status: result?.lead?.status || "BOOKED",
        project: result?.opportunity?.project || current.project,
        opportunities: result?.opportunity
          ? [result.opportunity, ...(current.opportunities || []).filter((item: any) => item.id !== result.opportunity.id)]
          : current.opportunities,
      } : current);
      toast({
        title: "Lead converted",
        description: `${oppNumber ? `${oppNumber} created` : "Opportunity created"}${ownerName ? ` — owner: ${ownerName}` : ""}${fallbackNote}. Lead status: BOOKED`,
      });
      setCreateOppDialogOpen(false);
      setOppName("");
      setOppAmount("");
      setOppDescription("");
      setOppProjectId("");
      setOppUnitId("");
      setOppUnits([]);
    } catch (err: any) {
      toast({ title: "Error", description: err?.response?.data?.error || "Failed to create opportunity", variant: "destructive" as any });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleCreateQuotation = async () => {
    if (!quoteDescription.trim() || !quoteUnitPrice) {
      toast({ title: "Validation", description: "Description and unit price are required", variant: "destructive" as any });
      return;
    }
    setIsActionLoading(true);
    try {
      const oppId = lead?.opportunities?.[0]?.id;
      await quotationApi.create({
        leadId,
        opportunityId: oppId,
        projectId: lead?.opportunities?.[0]?.projectId || lead?.siteVisits?.find((visit: any) => visit.status === "COMPLETED")?.projectId || lead?.project?.id,
        items: [
          {
            description: quoteDescription.trim(),
            quantity: 1,
            unitPrice: Number(quoteUnitPrice),
          },
        ],
      });
      toast({ title: "Success", description: "Quotation created" });
      setCreateQuoteDialogOpen(false);
      setQuoteDescription("");
      setQuoteUnitPrice("");
    } catch (err: any) {
      toast({ title: "Error", description: err?.response?.data?.error || "Failed to create quotation", variant: "destructive" as any });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleCreateBooking = async () => {
    if (!bookingProjectId || !bookingUnitId || !bookingAmount) {
      toast({ title: "Validation", description: "Project, unit, and amount are required", variant: "destructive" as any });
      return;
    }
    setIsActionLoading(true);
    try {
      const oppId = lead?.opportunities?.[0]?.id;
      await bookingApi.create({
        leadId,
        opportunityId: oppId,
        projectId: bookingProjectId,
        unitId: bookingUnitId,
        ownerId: lead?.owner?.id,
        totalAmount: Number(bookingAmount),
      });
      toast({ title: "Success", description: "Booking created" });
      setCreateBookingDialogOpen(false);
      setBookingProjectId("");
      setBookingUnitId("");
      setBookingAmount("");
      setBookingUnits([]);
    } catch (err: any) {
      toast({ title: "Error", description: err?.response?.data?.error || "Failed to create booking", variant: "destructive" as any });
    } finally {
      setIsActionLoading(false);
    }
  };

  const getWorkflowActions = (): { label: string; onClick: () => void; variant?: "default" | "outline" | "destructive" | "secondary" }[] => {
    const actions: { label: string; onClick: () => void; variant?: "default" | "outline" | "destructive" | "secondary" }[] = [];

    const canAct = canEditLead;
    if (!canAct) return actions;

    const visits = lead?.siteVisits || [];
    const activeSiteVisit =
      visits.find((sv: any) => String(sv.status).toUpperCase() === "SCHEDULED") || null;
    const latestSiteVisit = activeSiteVisit || visits[0] || null;

    const prof = profile?.name || "";
    const adminLike = isAdmin || isSuperAdmin || prof === "CRM Admin" || prof === "Manager";

    if (status === "INCOMING" && (prof === "Presales" || prof === "Sales Executive" || adminLike)) {
      actions.push({ label: "Push to SVC", onClick: () => setPushSvcDialogOpen(true), variant: "default" });
      actions.push({ label: "Move to Recovery", onClick: () => setRecoveryDialogOpen(true), variant: "destructive" });
    }

    if (status === "PROSPECT" && (prof === "SVC" || prof === "Sales Executive" || adminLike)) {
      actions.push({ label: "Schedule Site Visit", onClick: () => setSiteVisitDialogOpen(true), variant: "default" });
    }

    if (status === "SITE_VISIT_SCHEDULED" && activeSiteVisit && (prof === "SVC" || prof === "Sales" || prof === "Sales Executive" || adminLike)) {
      actions.push({ label: "Edit Site Visit", onClick: () => router.push(`/site-visits/${activeSiteVisit.id}`), variant: "outline" });
      actions.push({ label: "Revisit", onClick: () => setRevisitDialogOpen(true), variant: "outline" });
      actions.push({ label: "Cancel Site Visit", onClick: () => setCancelSvDialogOpen(true), variant: "destructive" });
      actions.push({ label: "Complete Site Visit", onClick: () => setCompleteSvDialogOpen(true), variant: "default" });
    }

    if (status === "SITE_VISIT_HAPPENED") {
      if (latestSiteVisit) {
        actions.push({ label: "Revisit", onClick: () => setRevisitDialogOpen(true), variant: "outline" });
      }
      if ((lead?.opportunities?.length || 0) > 0) {
        actions.push({ label: "View Opportunity", onClick: () => router.push(`/opportunities/${lead?.opportunities?.[0]?.id}`), variant: "default" });
      } else if (hasEffectivePermission("OPPORTUNITY_CREATE")) {
        actions.push({
          label: "Convert",
          onClick: () => {
            setOppName(`${lead?.company || `${lead?.firstName || ""} ${lead?.lastName || ""}`.trim()} Opportunity`);
            setOppDescription(lead?.requirements || lead?.notes || "");
            const completedVisit = lead?.siteVisits?.find((visit: any) => visit.status === "COMPLETED");
            setOppProjectId(completedVisit?.project?.id || lead?.project?.id || "");
            setOppUnitId("");
            setCreateOppDialogOpen(true);
          },
          variant: "default",
        });
      }
      if (hasEffectivePermission("QUOTATION_CREATE")) {
        actions.push({ label: "Create Quotation", onClick: () => setCreateQuoteDialogOpen(true), variant: "default" });
      }
      const opportunityProjectId = lead?.opportunities?.[0]?.projectId || latestSiteVisit?.projectId || lead?.project?.id;
      if (hasEffectivePermission("BOOKING_CREATE") && (lead?.opportunities?.length || 0) > 0 && opportunityProjectId) {
        actions.push({ label: "Create Booking", onClick: () => {
          setBookingProjectId(opportunityProjectId);
          setBookingUnitId("");
          setCreateBookingDialogOpen(true);
        }, variant: "default" });
      }
    }

    if (status === "BOOKED" && (lead?.opportunities?.length || 0) > 0) {
      actions.push({ label: "View Opportunity", onClick: () => router.push(`/opportunities/${lead?.opportunities?.[0]?.id}`), variant: "default" });
      if (hasEffectivePermission("QUOTATION_CREATE")) {
        actions.push({ label: "Create Quotation", onClick: () => setCreateQuoteDialogOpen(true), variant: "default" });
      }
      const opportunityProjectId = lead?.opportunities?.[0]?.projectId || lead?.siteVisits?.find((visit: any) => visit.status === "COMPLETED")?.projectId || lead?.project?.id;
      if (hasEffectivePermission("BOOKING_CREATE") && opportunityProjectId) {
        actions.push({ label: "Create Booking", onClick: () => {
          setBookingProjectId(opportunityProjectId);
          setBookingUnitId("");
          setCreateBookingDialogOpen(true);
        }, variant: "default" });
      }
    }

    return actions;
  };

  const workflowActions = getWorkflowActions();

  const formatAuditValue = (value: any): string => {
    if (value === null || value === undefined || value === "") return "—";
    if (value instanceof Date) return formatDateTime(value);
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  };

  const AUDIT_FIELD_LABELS: Record<string, string> = {
    ownerName: "Owner",
    previousOwnerName: "Previous Owner",
    newOwnerName: "New Owner",
    changedByName: "Changed By",
    assignmentSource: "Assignment Source",
    assignedTo: "Assigned To",
    cancellationReason: "Cancellation Reason",
    completedById: "Completed By",
    completedByName: "Completed By",
    cancelledById: "Cancelled By",
    changedById: "Changed By",
    createdBy: "Created By",
    updatedBy: "Updated By",
    assignedById: "Assigned By",
    performedById: "Performed By",
  };

  const auditFieldLabel = (field: string): string => {
    if (AUDIT_FIELD_LABELS[field]) return AUDIT_FIELD_LABELS[field];
    return field
      .replace(/Id$/, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/^./, (c) => c.toUpperCase());
  };

  const getAuditChanges = (entry: any): { field: string; oldValue: any; newValue: any }[] => {
    const oldVals = entry.oldValues || {};
    const newVals = entry.newValues || {};
    // Never render a raw user id when its display-name sibling exists —
    // the name row is shown instead (spec: audit shows names, never raw IDs).
    const hasNameSibling = (field: string): boolean =>
      field.endsWith("Id") &&
      (`${field.slice(0, -2)}Name` in oldVals || `${field.slice(0, -2)}Name` in newVals);
    const fields = new Set([...Object.keys(oldVals), ...Object.keys(newVals)]);
    const changes: { field: string; oldValue: any; newValue: any }[] = [];

    if (entry.action === "CREATE" || entry.action === "FOLLOW_UP_CREATED" || entry.action === "TASK_CREATED" || entry.action === "NOTE_CREATED") {
      for (const field of Object.keys(newVals)) {
        if (field === "reason" || field === "note") continue;
        if (hasNameSibling(field)) continue;
        changes.push({ field, oldValue: null, newValue: newVals[field] });
      }
      return changes;
    }

    for (const field of fields) {
      if (field === "reason" || field === "note") continue;
      if (hasNameSibling(field)) continue;
      const oldV = oldVals[field];
      const newV = newVals[field];
      if (JSON.stringify(oldV ?? null) !== JSON.stringify(newV ?? null)) {
        changes.push({ field, oldValue: field in oldVals ? oldV : undefined, newValue: newV });
      }
    }
    return changes;
  };

  const getAuditReason = (entry: any): string | null => {
    const newVals = entry.newValues || {};
    return newVals.reason || newVals.note || newVals.recoveryReason || null;
  };

  const lastModifiedBy = lead?.lastModified?.by;
  const lastModifiedAt = lead?.lastModified?.at || lead?.updatedAt;

  if (isLoading || authLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader><Skeleton className="h-4 w-24" /></CardHeader>
              <CardContent><Skeleton className="h-20 w-full" /></CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">{loadError || "Lead not found"}</p>
      </div>
    );
  }

  const leadDisplayName = `${lead.firstName ? lead.firstName + " " : ""}${lead.lastName}`;
  const leadProjectOptions = lead.project && !projects.some((project) => project.id === lead.project?.id)
    ? [...projects, { ...lead.project, isActive: false }]
    : projects;
  const renderProjectLoadState = () => {
    if (projectsLoading) {
      return <p role="status" className="text-sm text-muted-foreground">Loading projects...</p>;
    }
    if (projectsError) {
      return (
        <div role="alert" className="flex items-center justify-between gap-3 text-sm text-destructive">
          <span>{projectsError}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadProjects(true)}>
            Retry
          </Button>
        </div>
      );
    }
    if (projectsLoaded.current && projects.length === 0) {
      return <p role="status" className="text-sm text-muted-foreground">No projects available for this company.</p>;
    }
    return null;
  };

  const leadProfileName = profile?.name || "";
  const isPresales = leadProfileName === "Presales";
  const isSvc = leadProfileName === "SVC";
  const isSales = leadProfileName === "Sales";
  const isCrm = leadProfileName === "CRM";
  const isAdminLike = isAdmin || isSuperAdmin || leadProfileName === "CRM Admin" || leadProfileName === "Manager";
  const showOpportunities = isSales || isCrm || isSvc || isAdminLike;
  const showAuditHistory = isAdminLike;
  const showSiteVisits = isSvc || isSales || isCrm || isAdminLike || leadProfileName === "Sales Executive" || leadProfileName === "Presales";

  const openDetail = (kind: "task" | "followup" | "note" | "activity", data: any) => {
    setDetailItem({ kind, data });
    setDetailDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Lead Status Progression */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Lead Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {LEAD_STATUS_PROGRESSION.map((step, idx) => {
              const isCurrent = step.key === status;
              return (
                <React.Fragment key={step.key}>
                  <div className="flex flex-col items-center min-w-[80px]">
                    <div
                      className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-medium ${
                        isCurrent
                          ? "bg-blue-600 text-white ring-2 ring-blue-200"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {isCurrent ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <span className="text-[11px]">{idx + 1}</span>
                      )}
                    </div>
                    <span
                      className={`text-[11px] mt-1 text-center ${
                        isCurrent ? "font-semibold text-blue-600" : "text-muted-foreground"
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                  {idx < LEAD_STATUS_PROGRESSION.length - 1 && (
                    <div
                      className={`h-0.5 w-4 mt-[-12px] ${
                        isCurrent ? "bg-blue-400" : "bg-muted"
                      }`}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Lead Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold">{leadDisplayName}</h1>
            <Badge variant="outline" className="font-mono text-sm">
              {lead.leadNumber}
            </Badge>
            <Badge variant={STATUS_VARIANT[STATUS_LABELS[status] ? status : "default"]}>
              {STATUS_LABELS[status] || status}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm mt-1">Lead ID: {lead.id}</p>
          {lead.owner && (
            <p className="text-sm mt-1">
              <span className="text-muted-foreground">Owner: </span>
              <span className="font-medium">{lead.owner.firstName} {lead.owner.lastName}</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {canChangeOwner && !isEditing && (
            <Button
              variant="outline"
              size="sm"
              onClick={openOwnerDialog}
              disabled={isActionLoading}
            >
              <ArrowRight className="h-4 w-4 mr-1" />Change Owner
            </Button>
          )}
          {canEditLead && !isEditing && (
            <Button
              variant="outline"
              size="sm"
              onClick={startEdit}
              disabled={isActionLoading}
            >
              <Edit3 className="h-4 w-4 mr-1" />Edit
            </Button>
          )}
          {isEditing && (
            <>
              <Button
                size="sm"
                onClick={saveEdit}
                disabled={isActionLoading}
              >
                {isActionLoading ? (
                  <>
                    <Clock className="h-4 w-4 mr-1 animate-spin" />Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-1" />Save
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={cancelEdit}
                disabled={isActionLoading}
              >
                <X className="h-4 w-4 mr-1" />Cancel
              </Button>
            </>
          )}
          {!isEditing && workflowActions.map((action) => (
            <Button
              key={action.label}
              variant={action.variant || "default"}
              size="sm"
              onClick={action.onClick}
              disabled={isActionLoading}
            >
              {action.label}
            </Button>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFollowUpDialogOpen(true)}
          >
            <Clock className="h-4 w-4 mr-1" />Follow-up
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTaskDialogOpen(true)}
          >
            <CheckSquare className="h-4 w-4 mr-1" />Task
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setNoteDialogOpen(true)}
          >
            <StickyNote className="h-4 w-4 mr-1" />Note
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview" className="gap-2">
            <User className="h-4 w-4" />Overview
          </TabsTrigger>
          <TabsTrigger value="enquiries" className="gap-2">
            <Inbox className="h-4 w-4" />Enquiries
            {enquiries.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 min-w-5 justify-center px-1.5 text-[11px]">
                {enquiries.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="owner-history" className="gap-2">
            <History className="h-4 w-4" />Owner History
          </TabsTrigger>
          <TabsTrigger value="activities" className="gap-2">
            <History className="h-4 w-4" />Activities
          </TabsTrigger>
          <TabsTrigger value="tasks" className="gap-2">
            <CheckSquare className="h-4 w-4" />Tasks
          </TabsTrigger>
          <TabsTrigger value="followups" className="gap-2">
            <Clock className="h-4 w-4" />Follow-ups
          </TabsTrigger>
          {showSiteVisits && (
            <TabsTrigger value="site-visits" className="gap-2">
              <Map className="h-4 w-4" />Site Visits
              {lead.siteVisits && lead.siteVisits.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 min-w-5 justify-center px-1.5 text-[11px]">
                  {lead.siteVisits.length}
                </Badge>
              )}
            </TabsTrigger>
          )}
          {showOpportunities && (
            <TabsTrigger value="opportunities" className="gap-2">
              <TrendingUp className="h-4 w-4" />Opportunities
            </TabsTrigger>
          )}
          {showAuditHistory && (
            <TabsTrigger value="audit-history" className="gap-2">
              <FileText className="h-4 w-4" />Audit History
            </TabsTrigger>
          )}
        </TabsList>

        {/* Enquiries Tab */}
        <TabsContent value="enquiries">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Enquiries</CardTitle>
            </CardHeader>
            <CardContent>
              {enquiriesLoading ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Loading enquiries...</p>
              ) : enquiriesError ? (
                <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                  {enquiriesError}
                </div>
              ) : enquiries.length > 0 ? (
                <div className="space-y-3">
                  {enquiries.map((enquiry) => (
                    <button
                      key={enquiry.id}
                      type="button"
                      onClick={() => router.push(`/enquiries/${enquiry.id}`)}
                      className="w-full rounded-md border p-4 text-left transition-colors hover:bg-muted/50"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-medium">{enquiry.enquiryNumber}</span>
                        <Badge variant="outline">{enquiry.enquiryType.replaceAll("_", " ")}</Badge>
                      </div>
                      <dl className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                        <div>
                          <dt className="text-xs text-muted-foreground">Enquiry Source</dt>
                          <dd className="font-medium">{enquiry.source || "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Sub Source</dt>
                          <dd className="font-medium">{enquiry.subSource || "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Project</dt>
                          <dd className="font-medium">{enquiry.project?.name || "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Enquiry Date</dt>
                          <dd className="font-medium">{formatDateTime(enquiry.enquiryDate || enquiry.createdAt)}</dd>
                        </div>
                      </dl>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground">
                  <Inbox className="mx-auto mb-4 h-12 w-12 opacity-50" />
                  <p>No enquiries recorded for this lead.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {isEditing && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">Edit Reason (optional)</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  placeholder="Why are you updating this lead? This will be recorded in audit history..."
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                />
              </CardContent>
            </Card>
          )}
          {lead && layout && (
            <LayoutDrivenForm
              objectName="Lead"
              mode={isEditing ? "edit" : "detail"}
              data={isEditing ? editData : lead}
              onChange={
                isEditing
                  ? (field, value) => {
                      setEditData((prev) => ({ ...prev, [field]: value }));
                      if (field === "phone") {
                        setEditFieldErrors((prev) => {
                          if (!prev.phone) return prev;
                          const { phone: _phone, ...rest } = prev;
                          return rest;
                        });
                      }
                    }
                  : undefined
              }
              layout={layout}
              fields={fields}
              projects={leadProjectOptions}
              fieldErrors={isEditing ? editFieldErrors : undefined}
            />
          )}

          <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">Timeline</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Created</p>
                    <p className="text-xs text-muted-foreground">{formatDate(lead!.createdAt)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Last Updated</p>
                    <p className="text-xs text-muted-foreground">{formatDate(lead!.updatedAt)}</p>
                  </div>
                </div>
                {lead!.creator && (
                  <div className="flex items-center gap-3">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Created By</p>
                      <p className="text-xs text-muted-foreground">{lead!.creator.firstName} {lead!.creator.lastName}</p>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <Edit3 className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Last Modified</p>
                    <p className="text-xs text-muted-foreground">{lastModifiedAt ? formatDateTime(lastModifiedAt) : "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      by{" "}
                      {lastModifiedBy
                        ? `${lastModifiedBy.firstName} ${lastModifiedBy.lastName}`
                        : "Unknown"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
        </TabsContent>

        {/* Owner History Tab */}
        <TabsContent value="owner-history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Owner History</CardTitle>
            </CardHeader>
            <CardContent>
              {lead.ownerHistory && lead.ownerHistory.length > 0 ? (
                <div className="space-y-3">
                  {lead.ownerHistory.map((entry: any, idx: number) => (
                    <div key={idx} className="flex items-start gap-3 p-3 rounded-md bg-muted/50">
                      <User className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {entry.previousOwner && (
                            <span className="text-sm font-medium">
                              {entry.previousOwner.firstName} {entry.previousOwner.lastName}
                            </span>
                          )}
                          {entry.previousOwner && entry.newOwner && (
                            <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          )}
                          {entry.newOwner && (
                            <span className="text-sm font-medium">
                              {entry.newOwner.firstName} {entry.newOwner.lastName}
                            </span>
                          )}
                          {!entry.previousOwner && entry.newOwner && (
                            <span className="text-sm text-muted-foreground">Initial Assignment</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          {entry.previousProfile && <span>{entry.previousProfile}</span>}
                          {entry.previousProfile && entry.newProfile && <span>→</span>}
                          {entry.newProfile && <span>{entry.newProfile}</span>}
                        </div>
                        {entry.handoffReason && (
                          <p className="text-xs text-muted-foreground mt-1">{entry.handoffReason}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <span>{formatDateTime(entry.startDate)}</span>
                          {entry.endDate && <span>→ {formatDateTime(entry.endDate)}</span>}
                          {!entry.endDate && <span>→ Current</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No owner history recorded</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Activities Tab */}
        <TabsContent value="activities">
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {lead.activities && lead.activities.length > 0 ? (
                <div className="space-y-3 text-left">
                  {lead.activities.map((activity: any, idx: number) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => openDetail(activity.type === "NOTE" ? "note" : "activity", activity)}
                      className="w-full flex items-center gap-3 text-left p-3 rounded-md bg-muted/50 hover:bg-muted transition-colors"
                    >
                      <History className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm">{activity.subject || activity.description || activity.type}</p>
                        <p className="text-xs text-muted-foreground">{formatDateTime(activity.createdAt)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No activities recorded yet</p>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tasks Tab */}
        <TabsContent value="tasks">
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {lead.tasks && lead.tasks.length > 0 ? (
                <div className="space-y-3 text-left">
                  {lead.tasks.map((task: any, idx: number) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => openDetail("task", task)}
                      className="w-full flex items-center gap-3 text-left p-3 rounded-md bg-muted/50 hover:bg-muted transition-colors"
                    >
                      <CheckSquare className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm">{task.title || task.name}</p>
                        <p className="text-xs text-muted-foreground">{task.status} {task.dueDate ? `- Due ${formatDate(task.dueDate)}` : ""}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <CheckSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No tasks assigned</p>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Follow-ups Tab */}
        <TabsContent value="followups">
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {lead.followUps && lead.followUps.length > 0 ? (
                <div className="space-y-3 text-left">
                  {lead.followUps.map((fu: any, idx: number) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => openDetail("followup", fu)}
                      className="w-full flex items-center gap-3 text-left p-3 rounded-md bg-muted/50 hover:bg-muted transition-colors"
                    >
                      <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm">{fu.title || fu.description || fu.type}</p>
                        <p className="text-xs text-muted-foreground">{fu.dueDate ? formatDateTime(fu.dueDate) : fu.status}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No follow-ups scheduled</p>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Site Visits Tab */}
        {showSiteVisits && (
        <TabsContent value="site-visits">
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {lead.siteVisits && lead.siteVisits.length > 0 ? (
                <div className="space-y-3 text-left">
                  {lead.siteVisits.map((sv: any, idx: number) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => router.push(`/site-visits/${sv.id}`)}
                      className="w-full flex items-center gap-3 text-left p-3 rounded-md bg-muted/50 hover:bg-muted transition-colors"
                    >
                      <Map className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {sv.siteVisitNumber && (
                            <span className="text-sm font-medium font-mono">{sv.siteVisitNumber}</span>
                          )}
                          <Badge variant="outline">{sv.status || "SCHEDULED"}</Badge>
                          {sv.project?.name && <span className="text-sm text-muted-foreground">- {sv.project.name}</span>}
                        </div>
                        <p className="text-xs text-muted-foreground">{sv.scheduledAt ? formatDateTime(sv.scheduledAt) : sv.createdAt ? formatDateTime(sv.createdAt) : ""}</p>
                        {sv.assignee && <p className="text-xs text-muted-foreground">Assigned: {sv.assignee.firstName} {sv.assignee.lastName}</p>}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <Map className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No site visits scheduled</p>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        )}

        {/* Opportunities Tab */}
        {showOpportunities && (
        <TabsContent value="opportunities">
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {lead.opportunities && lead.opportunities.length > 0 ? (
                <div className="space-y-3 text-left">
                  {lead.opportunities.map((opp: any, idx: number) => (
                    <div key={idx} className="flex items-center gap-3 text-left p-3 rounded-md bg-muted/50">
                      <TrendingUp className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-sm">{opp.opportunityNumber ? `${opp.opportunityNumber} · ` : ""}{opp.name || opp.title || "Opportunity"}</p>
                        <p className="text-xs text-muted-foreground">
                          {opp.stage || opp.status} {opp.amount ? `- ₹${opp.amount.toLocaleString()}` : ""}
                          {opp.owner ? ` · ${opp.owner.firstName} ${opp.owner.lastName}` : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <TrendingUp className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No opportunities created</p>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        )}

        {/* Audit History Tab */}
        {showAuditHistory && (
        <TabsContent value="audit-history">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Audit History</CardTitle>
              <p className="text-xs text-muted-foreground">
                {auditTotal} record{auditTotal === 1 ? "" : "s"} · newest first
              </p>
            </CardHeader>
            <CardContent>
              {auditLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 w-full" />
                  ))}
                </div>
              ) : auditLogs.length > 0 ? (
                <div className="space-y-3">
                  {auditLogs.map((entry: any) => {
                    const changes = getAuditChanges(entry);
                    const reason = getAuditReason(entry);
                    const userName = entry.user
                      ? `${entry.user.firstName} ${entry.user.lastName}`
                      : "System";
                    return (
                      <div key={entry.id} className="p-3 rounded-md bg-muted/50 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{entry.action}</Badge>
                            <span className="text-sm font-medium">{userName}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {formatDateTime(entry.createdAt)}
                          </span>
                        </div>
                        {changes.length > 0 && (
                          <div className="space-y-1">
                            {changes.map((change, idx) => (
                              <div key={idx} className="text-xs flex flex-wrap items-center gap-1">
                                <span className="font-medium">{auditFieldLabel(change.field)}:</span>
                                {change.oldValue !== undefined ? (
                                  <>
                                    <span className="text-muted-foreground">
                                      {formatAuditValue(change.oldValue)}
                                    </span>
                                    <span aria-hidden="true">→</span>
                                    <span>{formatAuditValue(change.newValue)}</span>
                                  </>
                                ) : (
                                  <span>{formatAuditValue(change.newValue)}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {reason && (
                          <p className="text-xs text-muted-foreground">
                            Reason: {reason}
                          </p>
                        )}
                      </div>
                    );
                  })}
                  {auditTotalPages > 1 && (
                    <div className="flex items-center justify-between pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fetchAuditHistory(Math.max(1, auditPage - 1))}
                        disabled={auditPage <= 1 || auditLoading}
                      >
                        Previous
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        Page {auditPage} of {auditTotalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fetchAuditHistory(Math.min(auditTotalPages, auditPage + 1))}
                        disabled={auditPage >= auditTotalPages || auditLoading}
                      >
                        Next
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No audit history recorded</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        )}
      </Tabs>

      <Dialog open={ownerDialogOpen} onOpenChange={setOwnerDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Lead Owner</DialogTitle>
            <DialogDescription>
              Assign this lead to an eligible active user in the current tenant.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <span className="text-muted-foreground">Current Owner: </span>
              <span className="font-medium">
                {lead.owner ? `${lead.owner.firstName} ${lead.owner.lastName}` : "Unassigned"}
              </span>
            </div>
            <div className="space-y-2">
              <Label>New Owner *</Label>
              <Select value={newOwnerId} onValueChange={setNewOwnerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select User" />
                </SelectTrigger>
                <SelectContent>
                  {ownerCandidates.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.firstName} {candidate.lastName} ({candidate.profile?.name || "—"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {ownerCandidates.length === 0 && (
                <p className="text-sm text-muted-foreground">No eligible users are available.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="owner-change-reason">Reason *</Label>
              <Textarea
                id="owner-change-reason"
                value={ownerChangeReason}
                onChange={(event) => setOwnerChangeReason(event.target.value)}
                placeholder="Enter reason"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOwnerDialogOpen(false)} disabled={isActionLoading}>
              Cancel
            </Button>
            <Button onClick={changeOwner} disabled={isActionLoading || ownerCandidates.length === 0}>
              {isActionLoading ? "Changing..." : "Change Owner"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Push to SVC Dialog */}
      <Dialog open={pushSvcDialogOpen} onOpenChange={setPushSvcDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Push Lead to SVC?</DialogTitle>
            <DialogDescription>This lead will be moved to the Site Visit Coordinator workflow.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p className="mb-1 font-medium">Lead Information</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                <p>Lead Number: <span className="font-medium text-foreground">{lead.leadNumber}</span></p>
                <p>Name: <span className="font-medium text-foreground">{`${lead.firstName || ""} ${lead.lastName || ""}`.trim()}</span></p>
                <p>Phone: <span className="font-medium text-foreground">{lead.phone || lead.mobile || "—"}</span></p>
                <p>Company: <span className="font-medium text-foreground">{lead.company || "—"}</span></p>
                <p>Email: <span className="font-medium text-foreground">{lead.email || "—"}</span></p>
                <p>Owner: <span className="font-medium text-foreground">{lead.owner ? `${lead.owner.firstName} ${lead.owner.lastName}` : "Unassigned"}</span></p>
                <p>Project: <span className="font-medium text-foreground">{lead.project?.name || "—"}</span></p>
                <p>Status: <span className="font-medium text-foreground">{lead.status}</span></p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="push-svc-reason">Reason / Note *</Label>
              <Textarea
                id="push-svc-reason"
                placeholder="Enter reason for pushing to SVC..."
                value={pushSvcReason}
                onChange={(e) => setPushSvcReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPushSvcDialogOpen(false)} disabled={isActionLoading}>Cancel</Button>
            <Button onClick={handlePushToSVC} disabled={isActionLoading || !pushSvcReason.trim()}>
              {isActionLoading ? "Pushing..." : "Push to SVC"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move to Recovery Dialog */}
      <Dialog open={recoveryDialogOpen} onOpenChange={setRecoveryDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move Lead to Recovery?</DialogTitle>
            <DialogDescription>This lead will be marked as Lost and moved to the Recovery workflow.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); handleMoveToRecovery(); }}>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="recovery-reason">Reason *</Label>
                <Select value={recoveryReason} onValueChange={setRecoveryReason}>
                  <SelectTrigger id="recovery-reason">
                    <SelectValue placeholder="Select a reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {RECOVERY_REASONS.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="recovery-note">Note (optional)</Label>
                <Textarea
                  id="recovery-note"
                  placeholder="Add any additional notes..."
                  value={recoveryNote}
                  onChange={(e) => setRecoveryNote(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRecoveryDialogOpen(false)} disabled={isActionLoading}>Cancel</Button>
              <Button variant="destructive" type="submit" disabled={isActionLoading}>
                {isActionLoading ? "Moving..." : "Move to Recovery"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Schedule Site Visit Dialog */}
      <Dialog open={siteVisitDialogOpen} onOpenChange={setSiteVisitDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Site Visit</DialogTitle>
            <DialogDescription>All fields are mandatory.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="sv-project">Project *</Label>
              <Select value={svProjectId} onValueChange={setSvProjectId}>
                <SelectTrigger id="sv-project" disabled={projectsLoading || Boolean(projectsError) || projects.length === 0}>
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {renderProjectLoadState()}
            </div>
            <div className="space-y-2">
              <Label htmlFor="sv-note">Note / Reason *</Label>
              <Textarea
                id="sv-note"
                placeholder="Enter reason for site visit..."
                value={svNote}
                onChange={(e) => setSvNote(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sv-date">Visit Date *</Label>
                <Input
                  id="sv-date"
                  type="date"
                  value={svDate}
                  onChange={(e) => setSvDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sv-time">Visit Time *</Label>
                <Input
                  id="sv-time"
                  type="time"
                  value={svTime}
                  onChange={(e) => setSvTime(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSiteVisitDialogOpen(false)} disabled={isActionLoading}>Cancel</Button>
            <Button
              onClick={handleScheduleSiteVisit}
              disabled={isActionLoading || projectsLoading || Boolean(projectsError) || !projects.length || !svProjectId || !svNote.trim() || !svDate || !svTime}
            >
              {isActionLoading ? "Scheduling..." : "Schedule Visit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Follow-up Dialog */}
      <Dialog open={followUpDialogOpen} onOpenChange={setFollowUpDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Follow-up</DialogTitle>
            <DialogDescription>All fields are mandatory.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="fu-note">Note / Reason *</Label>
              <Textarea
                id="fu-note"
                placeholder="Enter follow-up note/reason..."
                value={followUpNote}
                onChange={(e) => setFollowUpNote(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="fu-date">Date *</Label>
                <Input
                  id="fu-date"
                  type="date"
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fu-time">Time *</Label>
                <Input
                  id="fu-time"
                  type="time"
                  value={followUpTime}
                  onChange={(e) => setFollowUpTime(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFollowUpDialogOpen(false)} disabled={isActionLoading}>Cancel</Button>
            <Button onClick={handleCreateFollowUp} disabled={isActionLoading}>
              {isActionLoading ? "Creating..." : "Create Follow-up"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Task Dialog */}
      <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Task</DialogTitle>
            <DialogDescription>All fields are mandatory.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="task-note">Description *</Label>
              <Textarea
                id="task-note"
                placeholder="Enter task description..."
                value={taskNote}
                onChange={(e) => setTaskNote(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="task-date">Due Date *</Label>
                <Input
                  id="task-date"
                  type="date"
                  value={taskDueDate}
                  onChange={(e) => setTaskDueDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="task-time">Time *</Label>
                <Input
                  id="task-time"
                  type="time"
                  value={taskTime}
                  onChange={(e) => setTaskTime(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTaskDialogOpen(false)} disabled={isActionLoading}>Cancel</Button>
            <Button onClick={handleCreateTask} disabled={isActionLoading}>
              {isActionLoading ? "Creating..." : "Create Task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Note Dialog */}
      <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Note</DialogTitle>
            <DialogDescription>Note content is mandatory.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="note-subject">Subject</Label>
              <Input
                id="note-subject"
                placeholder="Note subject..."
                value={noteSubject}
                onChange={(e) => setNoteSubject(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="note-content">Note Content *</Label>
              <Textarea
                id="note-content"
                placeholder="Enter note content..."
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteDialogOpen(false)} disabled={isActionLoading}>Cancel</Button>
            <Button onClick={handleCreateNote} disabled={isActionLoading || !noteContent.trim()}>
              {isActionLoading ? "Adding..." : "Add Note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog for Task / Follow-up / Note / Activity */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {detailItem?.kind === "task" && "Task Details"}
              {detailItem?.kind === "followup" && "Follow-up Details"}
              {detailItem?.kind === "note" && "Note Details"}
              {detailItem?.kind === "activity" && "Activity Details"}
            </DialogTitle>
            <DialogDescription>
              {detailItem?.kind === "task" && "Full task record"}
              {detailItem?.kind === "followup" && "Full follow-up record"}
              {detailItem?.kind === "note" && "Note content and metadata"}
              {detailItem?.kind === "activity" && "Activity content and metadata"}
            </DialogDescription>
          </DialogHeader>
          {detailItem && (
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {detailItem.kind === "task" || detailItem.kind === "followup" ? "Title" : "Subject"}
                </p>
                <p className="text-sm font-medium">
                  {detailItem.data.title || detailItem.data.subject || detailItem.data.description || "—"}
                </p>
              </div>
              {detailItem.data.description && detailItem.data.title && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Description</p>
                  <p className="text-sm whitespace-pre-wrap">{detailItem.data.description}</p>
                </div>
              )}
              {detailItem.data.status && (
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Status</span>
                  <Badge variant="outline">{detailItem.data.status}</Badge>
                </div>
              )}
              {detailItem.data.priority && (
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Priority</span>
                  <Badge variant="outline">{detailItem.data.priority}</Badge>
                </div>
              )}
              {detailItem.data.dueDate && (
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Due Date</span>
                  <span className="text-sm">{formatDateTime(detailItem.data.dueDate)}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Created</span>
                <span className="text-sm">{formatDateTime(detailItem.data.createdAt)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Updated</span>
                <span className="text-sm">{formatDateTime(detailItem.data.updatedAt || detailItem.data.createdAt)}</span>
              </div>
              {detailItem.data.owner && (
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Owner</span>
                  <span className="text-sm">{detailItem.data.owner.firstName} {detailItem.data.owner.lastName}</span>
                </div>
              )}
              {detailItem.data.user && (
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Created By</span>
                  <span className="text-sm">{detailItem.data.user.firstName} {detailItem.data.user.lastName}</span>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revisit Dialog */}
      <Dialog open={revisitDialogOpen} onOpenChange={setRevisitDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Revisit Site Visit</DialogTitle>
            <DialogDescription>A reason, date, time, and project are required.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="revisit-reason">Reason *</Label>
              <Textarea
                id="revisit-reason"
                placeholder="Why is a revisit needed?"
                value={revisitReason}
                onChange={(e) => setRevisitReason(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="revisit-date">Visit Date *</Label>
                <Input
                  id="revisit-date"
                  type="date"
                  value={revisitDate}
                  onChange={(e) => setRevisitDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="revisit-time">Visit Time *</Label>
                <Input
                  id="revisit-time"
                  type="time"
                  value={revisitTime}
                  onChange={(e) => setRevisitTime(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="revisit-project">Project *</Label>
              <Select value={revisitProjectId} onValueChange={setRevisitProjectId}>
                <SelectTrigger disabled={projectsLoading || Boolean(projectsError) || projects.length === 0}>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {renderProjectLoadState()}
            </div>
            <div className="space-y-2">
              <Label htmlFor="revisit-note">Notes</Label>
              <Textarea
                id="revisit-note"
                placeholder="Optional notes..."
                value={revisitNote}
                onChange={(e) => setRevisitNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevisitDialogOpen(false)} disabled={isActionLoading}>Cancel</Button>
            <Button onClick={handleRevisit} disabled={isActionLoading}>
              {isActionLoading ? "Creating..." : "Create Revisit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Site Visit Dialog */}
      <Dialog open={cancelSvDialogOpen} onOpenChange={setCancelSvDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Site Visit</DialogTitle>
            <DialogDescription>A reason is required. Lead returns to Prospect.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="cancel-reason">Reason *</Label>
              <Textarea
                id="cancel-reason"
                placeholder="Why is this site visit being cancelled?"
                value={cancelSvReason}
                onChange={(e) => setCancelSvReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelSvDialogOpen(false)} disabled={isActionLoading}>Back</Button>
            <Button variant="destructive" onClick={handleCancelSiteVisit} disabled={isActionLoading}>
              {isActionLoading ? "Cancelling..." : "Cancel Site Visit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete Site Visit Dialog */}
      <Dialog open={completeSvDialogOpen} onOpenChange={setCompleteSvDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete Site Visit</DialogTitle>
            <DialogDescription>Marks the site visit as happened. Lead moves to Site Visit Happened. Location access is required, and you must be within 100 meters of the project.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="complete-time">Completion Time *</Label>
              <Input id="complete-time" type="datetime-local" value={completeSvTime} onChange={(e) => setCompleteSvTime(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="complete-feedback">Customer Feedback *</Label>
              <Textarea
                id="complete-feedback"
                placeholder="Client feedback..."
                value={completeSvFeedback}
                onChange={(e) => setCompleteSvFeedback(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="complete-notes">Notes *</Label>
              <Textarea id="complete-notes" value={completeSvNotes} onChange={(e) => setCompleteSvNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteSvDialogOpen(false)} disabled={isActionLoading}>Back</Button>
            <Button onClick={handleCompleteSiteVisit} disabled={isActionLoading || !completeSvTime || !completeSvFeedback.trim() || !completeSvNotes.trim()}>
              {isActionLoading ? "Completing..." : "Complete Site Visit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={locationConsentOpen} onOpenChange={(open) => !isActionLoading && setLocationConsentOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Allow location access</DialogTitle>
            <DialogDescription>
              Your device location will be checked once against {getActiveSiteVisit()?.project?.name || getActiveSiteVisit()?.projectName || lead?.project?.name || "the site-visit project"}. The visit only completes if you are within 100 meters. Choose Allow Location Access to continue. To see the browser permission prompt, set this site&apos;s Location permission to Ask in the site information panel.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLocationConsentOpen(false)} disabled={isActionLoading}>Cancel</Button>
            <Button onClick={handleConfirmLocationAndComplete} disabled={isActionLoading}>
              {isActionLoading ? "Checking location..." : "Allow Location Access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Opportunity Dialog */}
      <Dialog open={createOppDialogOpen} onOpenChange={setCreateOppDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Convert Lead to Opportunity</DialogTitle>
            <DialogDescription>
              {lead?.leadNumber} · {lead?.firstName || ""} {lead?.lastName || ""} · Completed Site Visit: {
                lead?.siteVisits?.find((visit: any) => visit.status === "COMPLETED")?.siteVisitNumber || "—"
              }
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-3 rounded-md border p-3 text-sm sm:grid-cols-2">
              <div><span className="font-medium">Phone:</span> {lead?.phone || lead?.mobile || "—"}</div>
              <div><span className="font-medium">Email:</span> {lead?.email || "—"}</div>
              <div><span className="font-medium">Company:</span> {lead?.company || "—"}</div>
              <div><span className="font-medium">Lead Source:</span> {lead?.source || "—"}</div>
              <div><span className="font-medium">Budget:</span> {lead?.budget ?? "—"}</div>
              <div><span className="font-medium">Requirements:</span> {lead?.requirements || "—"}</div>
            </div>
            {(() => {
              const completedVisit = lead?.siteVisits?.find((visit: any) => visit.status === "COMPLETED");
              return (
                <div className="space-y-2 rounded-md border p-3 text-sm">
                  <div className="font-medium">Completed Site Visit</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>Visit Number: {completedVisit?.siteVisitNumber || "—"}</div>
                    <div>Completed At: {completedVisit?.completedAt ? formatDateTime(completedVisit.completedAt) : "—"}</div>
                    <div>Project: {completedVisit?.project?.name || lead?.project?.name || "—"}</div>
                    <div>Assigned Sales User: {completedVisit?.assignee ? `${completedVisit.assignee.firstName || ""} ${completedVisit.assignee.lastName || ""}`.trim() : "—"}</div>
                  </div>
                  <div>Customer Feedback: {completedVisit?.customerFeedback || "—"}</div>
                  <div>Completion Notes: {completedVisit?.completionNotes || "—"}</div>
                </div>
              );
            })()}
            <div className="space-y-2">
              <Label htmlFor="opp-name">Name *</Label>
              <Input
                id="opp-name"
                placeholder="Opportunity name..."
                value={oppName}
                onChange={(e) => setOppName(e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Project *</Label>
                <Select
                  value={oppProjectId}
                  onValueChange={(value) => {
                    setOppProjectId(value);
                    setOppUnitId("");
                  }}
                >
                  <SelectTrigger disabled={projectsLoading || Boolean(projectsError) || projects.length === 0}>
                    <SelectValue placeholder="Select an active project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.filter((project) => project.isActive !== false).map((project) => (
                      <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {projectsError && (
                  <p className="text-sm text-destructive">
                    {projectsError}{" "}
                    <Button type="button" variant="link" className="h-auto p-0" onClick={() => void loadProjects(true)}>Retry</Button>
                  </p>
                )}
                {!projectsLoading && !projectsError && projects.length === 0 && (
                  <p className="text-sm text-muted-foreground">No active projects are available.</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Unit</Label>
                <Select value={oppUnitId} onValueChange={setOppUnitId} disabled={!oppProjectId || oppUnitsLoading}>
                  <SelectTrigger>
                    <SelectValue placeholder={oppUnitsLoading ? "Loading units..." : "Select an available unit"} />
                  </SelectTrigger>
                  <SelectContent>
                    {oppUnits.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {unit.number}{unit.type ? ` · ${unit.type}` : ""}{unit.area ? ` · ${unit.area} sq.ft` : ""}{unit.price ? ` · ₹${unit.price}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {oppUnitsError && <p className="text-sm text-destructive">{oppUnitsError}</p>}
                {!oppUnitsLoading && !oppUnitsError && oppProjectId && oppUnits.length === 0 && (
                  <p className="text-sm text-muted-foreground">No available units for this project.</p>
                )}
              </div>
            </div>
            {oppUnitId && (() => {
              const unit = oppUnits.find((item) => item.id === oppUnitId);
              return unit ? (
                <div className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-2">
                  <div><span className="font-medium">Unit Number:</span> {unit.number}</div>
                  <div><span className="font-medium">Unit Type:</span> {unit.type || "—"}</div>
                  <div><span className="font-medium">Saleable Area:</span> {unit.area ?? "—"}</div>
                  <div><span className="font-medium">Price:</span> {unit.price ?? "—"}</div>
                  <div><span className="font-medium">Status:</span> {unit.status}</div>
                </div>
              ) : null;
            })()}
            <div className="space-y-2">
              <Label htmlFor="opp-amount">Amount</Label>
              <Input
                id="opp-amount"
                type="number"
                value={oppAmount}
                onChange={(e) => setOppAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="opp-description">Description</Label>
              <Textarea
                id="opp-description"
                placeholder="Description..."
                value={oppDescription}
                onChange={(e) => setOppDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOppDialogOpen(false)} disabled={isActionLoading}>Cancel</Button>
            <Button onClick={handleCreateOpportunity} disabled={isActionLoading || !oppProjectId}>
              {isActionLoading ? "Creating..." : "Create Opportunity"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Quotation Dialog */}
      <Dialog open={createQuoteDialogOpen} onOpenChange={setCreateQuoteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Quotation</DialogTitle>
            <DialogDescription>Description and unit price are required.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="quote-description">Description *</Label>
              <Input
                id="quote-description"
                placeholder="Line item description..."
                value={quoteDescription}
                onChange={(e) => setQuoteDescription(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quote-unit-price">Unit Price *</Label>
              <Input
                id="quote-unit-price"
                type="number"
                value={quoteUnitPrice}
                onChange={(e) => setQuoteUnitPrice(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateQuoteDialogOpen(false)} disabled={isActionLoading}>Cancel</Button>
            <Button onClick={handleCreateQuotation} disabled={isActionLoading}>
              {isActionLoading ? "Creating..." : "Create Quotation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Booking Dialog */}
      <Dialog open={createBookingDialogOpen} onOpenChange={setCreateBookingDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Booking</DialogTitle>
            <DialogDescription>Project, unit, and amount are required.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="booking-project">Project *</Label>
              <Select value={bookingProjectId} onValueChange={(value) => {
                setBookingProjectId(value);
                setBookingUnitId("");
              }}>
                <SelectTrigger disabled={projectsLoading || Boolean(projectsError) || projects.length === 0}>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="booking-unit">Unit *</Label>
              <Select value={bookingUnitId} onValueChange={setBookingUnitId} disabled={!bookingProjectId || bookingUnitsLoading || bookingUnits.length === 0}>
                <SelectTrigger id="booking-unit">
                  <SelectValue placeholder={bookingUnitsLoading ? "Loading units..." : "Select an available unit"} />
                </SelectTrigger>
                <SelectContent>
                  {bookingUnits.map((unit) => (
                    <SelectItem key={unit.id} value={unit.id}>
                      {unit.number}{unit.type ? ` · ${unit.type}` : ""}{unit.area ? ` · ${unit.area} sq.ft` : ""}{unit.price ? ` · ₹${unit.price}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {bookingUnitsError && <p className="text-sm text-destructive">{bookingUnitsError}</p>}
              {!bookingUnitsLoading && !bookingUnitsError && bookingProjectId && bookingUnits.length === 0 && (
                <p className="text-sm text-muted-foreground">No available units for this project.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="booking-amount">Total Amount *</Label>
              <Input
                id="booking-amount"
                type="number"
                value={bookingAmount}
                onChange={(e) => setBookingAmount(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateBookingDialogOpen(false)} disabled={isActionLoading}>Cancel</Button>
            <Button onClick={handleCreateBooking} disabled={isActionLoading}>
              {isActionLoading ? "Creating..." : "Create Booking"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}