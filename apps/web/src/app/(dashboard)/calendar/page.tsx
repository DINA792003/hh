"use client";

import * as React from "react";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileText,
  Filter,
  MapPin,
  Plus,
  Search,
  StickyNote,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { activityApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type CalendarView = "month" | "week" | "day";
type ActivityType = "TASK" | "SITE_VISIT" | "FOLLOW_UP" | "SCHEDULE" | "MEMO" | "MEETING";
type ActivityStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
type ActivityPriority = "LOW" | "MEDIUM" | "HIGH";

interface CalendarActivity {
  id: string;
  title: string;
  subject: string;
  description?: string | null;
  notes?: string | null;
  activityType: string;
  type: string;
  start: string;
  end: string;
  status: ActivityStatus;
  priority: ActivityPriority;
  assignedTo?: string | null;
  assignedToId?: string | null;
  createdBy?: string | null;
  location?: string | null;
  meetingUrl?: string | null;
  reminderAt?: string | null;
  leadId?: string | null;
  customerId?: string | null;
  opportunityId?: string | null;
  lead?: { id: string; firstName?: string | null; lastName: string; company?: string } | null;
  opportunity?: { id: string; name: string } | null;
}

interface CalendarOptions {
  users: Array<{ id: string; firstName: string; lastName: string }>;
  leads: Array<{ id: string; firstName?: string | null; lastName: string; company: string }>;
  opportunities: Array<{ id: string; name: string }>;
}

interface ActivityFormValues {
  activityType: ActivityType;
  title: string;
  description: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  assignedToId: string;
  leadId: string;
  opportunityId: string;
  location: string;
  meetingUrl: string;
  priority: ActivityPriority;
  status: ActivityStatus;
  reminderAt: string;
  notes: string;
}

const activityTypeOptions: Array<{ value: ActivityType; label: string; icon: React.ElementType; dot: string }> = [
  { value: "TASK", label: "Task", icon: CheckCircle2, dot: "bg-blue-500" },
  { value: "SITE_VISIT", label: "Site Visit", icon: MapPin, dot: "bg-emerald-500" },
  { value: "FOLLOW_UP", label: "Follow-up", icon: Clock3, dot: "bg-amber-500" },
  { value: "SCHEDULE", label: "Schedule", icon: CalendarDays, dot: "bg-violet-500" },
  { value: "MEMO", label: "Memo", icon: StickyNote, dot: "bg-slate-500" },
  { value: "MEETING", label: "Meeting", icon: Users, dot: "bg-indigo-500" },
];

const statusOptions: Array<{ value: ActivityStatus; label: string }> = [
  { value: "PLANNED", label: "Planned" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];
const priorityOptions: ActivityPriority[] = ["LOW", "MEDIUM", "HIGH"];

const typeStyles: Record<string, string> = {
  TASK: "border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100",
  SITE_VISIT: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
  FOLLOW_UP: "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100",
  SCHEDULE: "border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100",
  MEMO: "border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-200",
  NOTE: "border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-200",
  MEETING: "border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100",
  CALL: "border-cyan-200 bg-cyan-50 text-cyan-800 hover:bg-cyan-100",
  EMAIL: "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100",
  WHATSAPP: "border-green-200 bg-green-50 text-green-800 hover:bg-green-100",
  SYSTEM: "border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100",
};

function getType(activity: CalendarActivity): string {
  return activity.activityType === "NOTE" ? "MEMO" : activity.activityType || activity.type;
}

function getTypeLabel(type: string): string {
  return activityTypeOptions.find((option) => option.value === type)?.label || type.replaceAll("_", " ");
}

function localInputValue(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

function localDateValue(date: Date): string {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 10);
}

function makeFormValues(activity?: CalendarActivity | null, selectedStart?: Date | null): ActivityFormValues {
  const start = activity?.start ? new Date(activity.start) : selectedStart || new Date();
  const end = activity?.end ? new Date(activity.end) : new Date(start.getTime() + 60 * 60 * 1000);
  return {
    activityType: (activity ? getType(activity) : "TASK") as ActivityType,
    title: activity?.title || "",
    description: activity?.description || "",
    startDate: localDateValue(start),
    startTime: format(start, "HH:mm"),
    endDate: localDateValue(end),
    endTime: format(end, "HH:mm"),
    assignedToId: activity?.assignedToId || "",
    leadId: activity?.leadId || activity?.customerId || "",
    opportunityId: activity?.opportunityId || "",
    location: activity?.location || "",
    meetingUrl: activity?.meetingUrl || "",
    priority: activity?.priority || "MEDIUM",
    status: activity?.status || "PLANNED",
    reminderAt: localInputValue(activity?.reminderAt),
    notes: activity?.notes || "",
  };
}

function composeLocalDate(date: string, time: string): Date {
  return new Date(`${date}T${time || "00:00"}:00`);
}

function displayDateTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? format(date, "EEE, MMM d, yyyy · h:mm a") : "Not scheduled";
}

function ActivityEvent({
  activity,
  compact = false,
  onOpen,
  onResizeStart,
}: {
  activity: CalendarActivity;
  compact?: boolean;
  onOpen: (activity: CalendarActivity) => void;
  onResizeStart?: (event: React.PointerEvent<HTMLButtonElement>, activity: CalendarActivity) => void;
}) {
  const type = getType(activity);
  const TypeIcon = activityTypeOptions.find((option) => option.value === type)?.icon || FileText;
  const time = activity.start ? format(new Date(activity.start), "h:mm a") : "";
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      aria-label={`${getTypeLabel(type)}: ${activity.title}, ${time}`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(activity);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(activity);
        }
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/activity-id", activity.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      title={`${getTypeLabel(type)} · ${activity.title} · ${time}`}
      className={cn(
        "group relative flex min-w-0 cursor-pointer items-center gap-1 overflow-hidden rounded border px-1.5 text-left text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        typeStyles[type] || typeStyles.SYSTEM,
        activity.status === "COMPLETED" && "opacity-70"
      )}
    >
      <TypeIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className={cn("shrink-0", activity.status === "COMPLETED" && "line-through")}>
        {time}
      </span>
      <span className="truncate">{activity.title}</span>
      {!compact && onResizeStart && activity.status !== "COMPLETED" && (
        <button
          type="button"
          aria-label={`Resize ${activity.title}`}
          onPointerDown={(event) => onResizeStart(event, activity)}
          onClick={(event) => event.stopPropagation()}
          className="absolute inset-x-0 bottom-0 z-10 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100 focus:opacity-100"
        >
          <span className="mx-auto block h-0.5 w-6 rounded-full bg-current" />
        </button>
      )}
    </div>
  );
}

function ActivityField({ label, children, className }: { label: string; children: React.ReactElement<{ id?: string }>; className?: string }) {
  const id = React.useId();
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="text-xs font-medium text-foreground">{label}</Label>
      {React.cloneElement(children, { id })}
    </div>
  );
}

export default function CalendarPage() {
  const { hasPermission, user } = useAuth();
  const { toast } = useToast();
  const canCreate = hasPermission("Activity", "create");
  const canEdit = hasPermission("Activity", "edit");
  const canDelete = hasPermission("Activity", "delete");
  const [selectedDate, setSelectedDate] = React.useState(() => new Date());
  const [view, setView] = React.useState<CalendarView>("month");
  const [activities, setActivities] = React.useState<CalendarActivity[]>([]);
  const [summary, setSummary] = React.useState({ total: 0, today: 0, upcoming: 0, completed: 0, siteVisits: 0, meetings: 0 });
  const [options, setOptions] = React.useState<CalendarOptions>({ users: [], leads: [], opportunities: [] });
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const [searchDraft, setSearchDraft] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [selectedTypes, setSelectedTypes] = React.useState<ActivityType[]>(activityTypeOptions.map((option) => option.value));
  const [selectedStatuses, setSelectedStatuses] = React.useState<ActivityStatus[]>(statusOptions.map((option) => option.value));
  const [selectedPriorities, setSelectedPriorities] = React.useState<ActivityPriority[]>(priorityOptions);
  const [assignedFilter, setAssignedFilter] = React.useState("");
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [dialogMode, setDialogMode] = React.useState<"create" | "edit" | "details">("create");
  const [activeActivity, setActiveActivity] = React.useState<CalendarActivity | null>(null);
  const [form, setForm] = React.useState<ActivityFormValues>(() => makeFormValues(null));
  const [saving, setSaving] = React.useState(false);
  const [resizePreview, setResizePreview] = React.useState<{ id: string; end: string } | null>(null);

  const calendarStart = React.useMemo(() => {
    if (view === "month") return startOfWeek(startOfMonth(selectedDate), { weekStartsOn: 1 });
    if (view === "week") return startOfWeek(selectedDate, { weekStartsOn: 1 });
    return startOfDay(selectedDate);
  }, [selectedDate, view]);
  const calendarEnd = React.useMemo(() => {
    if (view === "month") return endOfWeek(endOfMonth(selectedDate), { weekStartsOn: 1 });
    if (view === "week") return endOfWeek(selectedDate, { weekStartsOn: 1 });
    return endOfDay(selectedDate);
  }, [selectedDate, view]);
  const days = React.useMemo(() => {
    const count = view === "day" ? 1 : view === "week" ? 7 : 42;
    return Array.from({ length: count }, (_, index) => addDays(calendarStart, index));
  }, [calendarStart, view]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchDraft.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const loadCalendar = React.useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [activityResponse, summaryResponse] = await Promise.all([
        activityApi.list({
          start: calendarStart.toISOString(),
          end: calendarEnd.toISOString(),
          search: search || undefined,
          activity_type: selectedTypes.length < activityTypeOptions.length ? selectedTypes.join(",") : undefined,
          status: selectedStatuses.length < statusOptions.length ? selectedStatuses.join(",") : undefined,
          priority: selectedPriorities.length < priorityOptions.length ? selectedPriorities.join(",") : undefined,
          assigned_to: assignedFilter || undefined,
        }),
        activityApi.summary({
          todayStart: startOfDay(new Date()).toISOString(),
          todayEnd: endOfDay(new Date()).toISOString(),
        }),
      ]);
      setActivities(activityResponse.data.data || []);
      setSummary(summaryResponse.data.data || { total: 0, today: 0, upcoming: 0, completed: 0, siteVisits: 0, meetings: 0 });
    } catch (error: any) {
      console.error("Load activity calendar error:", error);
      setLoadError(error?.response?.data?.error || "We couldn't load your calendar. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [assignedFilter, calendarEnd, calendarStart, search, selectedPriorities, selectedStatuses, selectedTypes]);

  React.useEffect(() => {
    void loadCalendar();
  }, [loadCalendar]);

  React.useEffect(() => {
    activityApi.options()
      .then((response) => setOptions(response.data.data || { users: [], leads: [], opportunities: [] }))
      .catch((error) => {
        console.error("Load activity calendar options error:", error);
        toast({ title: "Some activity fields are unavailable", description: error?.response?.data?.error || "Please refresh and try again.", variant: "destructive" });
      });
  }, [toast]);

  const changeDate = (direction: -1 | 1) => {
    setSelectedDate((current) => view === "month"
      ? addMonths(current, direction)
      : view === "week" ? addWeeks(current, direction) : addDays(current, direction));
  };

  const openCreate = (date = new Date()) => {
    if (!canCreate) {
      toast({ title: "Permission required", description: "You do not have permission to create activities.", variant: "destructive" });
      return;
    }
    setActiveActivity(null);
    setForm(makeFormValues(null, date));
    setDialogMode("create");
    setDialogOpen(true);
  };

  const openDetails = (activity: CalendarActivity) => {
    setActiveActivity(activity);
    setDialogMode("details");
    setDialogOpen(true);
  };

  const openEdit = (activity: CalendarActivity) => {
    if (!canEdit) return;
    setActiveActivity(activity);
    setForm(makeFormValues(activity));
    setDialogMode("edit");
    setDialogOpen(true);
  };

  const persistUpdate = React.useCallback(async (
    activity: CalendarActivity,
    patch: { startAt?: string; endAt?: string; status?: ActivityStatus },
    optimistic = true,
  ) => {
    const previous = activity;
    const updated = {
      ...activity,
      ...(patch.startAt ? { start: patch.startAt } : {}),
      ...(patch.endAt ? { end: patch.endAt } : {}),
      ...(patch.status ? { status: patch.status } : {}),
    };
    if (optimistic) setActivities((current) => current.map((item) => item.id === activity.id ? updated : item));
    try {
      const response = await activityApi.update(activity.id, patch);
      const saved = response.data.data as CalendarActivity;
      setActivities((current) => current.map((item) => item.id === activity.id ? { ...updated, ...saved } : item));
      if (activeActivity?.id === activity.id) setActiveActivity((current) => current ? { ...current, ...updated, ...saved } : current);
      return true;
    } catch (error: any) {
      if (optimistic) setActivities((current) => current.map((item) => item.id === activity.id ? previous : item));
      toast({
        title: "Activity update failed",
        description: error?.response?.data?.error || "The change could not be saved. Your calendar has been restored.",
        variant: "destructive",
      });
      return false;
    }
  }, [activeActivity?.id, toast]);

  const reschedule = async (activity: CalendarActivity, newStart: Date) => {
    const oldStart = new Date(activity.start);
    const oldEnd = new Date(activity.end);
    const duration = Math.max(15 * 60_000, oldEnd.getTime() - oldStart.getTime());
    const end = new Date(newStart.getTime() + duration);
    await persistUpdate(activity, { startAt: newStart.toISOString(), endAt: end.toISOString() });
  };

  const startResize = (event: React.PointerEvent<HTMLButtonElement>, activity: CalendarActivity) => {
    if (!canEdit) return;
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const originalEnd = new Date(activity.end);
    let previewEnd = originalEnd;
    const onMove = (moveEvent: PointerEvent) => {
      const minutes = Math.round(((moveEvent.clientY - startY) / 56) * 60 / 15) * 15;
      previewEnd = new Date(Math.max(new Date(activity.start).getTime() + 15 * 60_000, originalEnd.getTime() + minutes * 60_000));
      setResizePreview({ id: activity.id, end: previewEnd.toISOString() });
    };
    const onUp = async () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setResizePreview(null);
      const nextEnd = previewEnd.toISOString();
      if (nextEnd !== activity.end) await persistUpdate(activity, { endAt: nextEnd });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  const handleDrop = (event: React.DragEvent<HTMLElement>, day: Date, hour?: number) => {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/activity-id");
    const activity = activities.find((item) => item.id === id);
    if (!activity || !canEdit) return;
    const start = new Date(activity.start);
    const nextStart = new Date(day);
    nextStart.setHours(hour === undefined ? start.getHours() : hour, hour === undefined ? start.getMinutes() : 0, 0, 0);
    if (nextStart.getTime() !== start.getTime()) void reschedule(activity, nextStart);
  };

  const submitForm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const start = composeLocalDate(form.startDate, form.startTime);
    const end = composeLocalDate(form.endDate, form.endTime);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      toast({ title: "Check the activity time", description: "End date and time must be after the start date and time.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      type: form.activityType,
      subject: form.title.trim(),
      description: form.description.trim() || undefined,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      assignedToId: form.assignedToId || null,
      leadId: form.leadId || null,
      opportunityId: form.opportunityId || null,
      location: form.location.trim() || null,
      meetingUrl: form.meetingUrl.trim() || null,
      priority: form.priority,
      status: form.status,
      reminderAt: form.reminderAt ? new Date(form.reminderAt).toISOString() : null,
      notes: form.notes.trim() || null,
    };
    try {
      if (dialogMode === "edit" && activeActivity) {
        await activityApi.update(activeActivity.id, payload);
        toast({ title: "Activity updated", description: "Your changes have been saved." });
      } else {
        await activityApi.create(payload);
        toast({ title: "Activity created", description: "The activity has been added to your calendar." });
      }
      setDialogOpen(false);
      await loadCalendar();
    } catch (error: any) {
      console.error("Save calendar activity error:", error);
      toast({ title: "Unable to save activity", description: error?.response?.data?.error || "Please review the fields and try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const deleteActivity = async () => {
    if (!activeActivity || !canDelete) return;
    if (!window.confirm(`Delete "${activeActivity.title}"? This action cannot be undone.`)) return;
    try {
      await activityApi.delete(activeActivity.id);
      setDialogOpen(false);
      toast({ title: "Activity deleted", description: "The activity was removed from your calendar." });
      await loadCalendar();
    } catch (error: any) {
      toast({ title: "Unable to delete activity", description: error?.response?.data?.error || "You may not have permission to delete this activity.", variant: "destructive" });
    }
  };

  const markCompleted = async () => {
    if (!activeActivity || !canEdit) return;
    const success = await persistUpdate(activeActivity, { status: "COMPLETED" }, false);
    if (success) {
      setDialogOpen(false);
      toast({ title: "Activity completed", description: "The activity status has been updated." });
      await loadCalendar();
    }
  };

  const toggleValue = <T extends string>(values: T[], value: T, setter: React.Dispatch<React.SetStateAction<T[]>>) => {
    setter((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  };

  const visibleActivities = activities.filter((activity) =>
    selectedTypes.includes(getType(activity) as ActivityType) &&
    selectedStatuses.includes(activity.status) &&
    selectedPriorities.includes(activity.priority) &&
    (!assignedFilter || activity.assignedToId === assignedFilter)
  );

  const dateTitle = view === "day"
    ? format(selectedDate, "EEEE, MMMM d, yyyy")
    : view === "week"
      ? `${format(days[0], "MMM d")} – ${format(days[6], "MMM d, yyyy")}`
      : format(selectedDate, "MMMM yyyy");

  const assignedUserName = (activity: CalendarActivity) => activity.assignedTo || "Unassigned";
  const relatedName = (activity: CalendarActivity) => {
    if (activity.lead) return [activity.lead.firstName, activity.lead.lastName].filter(Boolean).join(" ") || activity.lead.company || "Related lead";
    if (activity.opportunity) return activity.opportunity.name;
    return "No linked lead or opportunity";
  };
  const meetingUrl = activeActivity?.meetingUrl && (() => {
    try {
      const url = new URL(activeActivity.meetingUrl);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  })();

  const summaryCards = [
    { label: "Total activities", value: summary.total, icon: CalendarDays },
    { label: "Today", value: summary.today, icon: Clock3 },
    { label: "Upcoming", value: summary.upcoming, icon: CalendarDays },
    { label: "Completed", value: summary.completed, icon: CheckCircle2 },
    { label: "Site visits", value: summary.siteVisits, icon: MapPin },
    { label: "Meetings", value: summary.meetings, icon: Users },
  ];

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 pb-8">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Workspace</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">CRM Calendar</h1>
          <p className="mt-1 text-sm text-muted-foreground">A shared view of the work and customer moments ahead.</p>
        </div>
        <Button onClick={() => openCreate()} disabled={!canCreate}>
          <Plus className="h-4 w-4" />
          New Activity
        </Button>
      </div>

      <section aria-label="Activity summary" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {summaryCards.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-lg border bg-card p-3 shadow-sm">
            <div className="flex items-center justify-between gap-2 text-muted-foreground">
              <span className="text-xs">{label}</span>
              <Icon className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{loading ? <span className="inline-block h-7 w-10 animate-pulse rounded bg-muted" /> : value}</div>
          </div>
        ))}
      </section>

      <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center">
            <Button variant="outline" size="icon" aria-label="Previous period" onClick={() => changeDate(-1)}><ChevronLeft /></Button>
            <Button variant="outline" size="icon" aria-label="Next period" onClick={() => changeDate(1)}><ChevronRight /></Button>
          </div>
          <Button variant="outline" onClick={() => setSelectedDate(new Date())}>Today</Button>
          <h2 className="min-w-40 text-base font-semibold" aria-live="polite">{dateTitle}</h2>
          <Input
            aria-label="Choose calendar date"
            type="date"
            value={localDateValue(selectedDate)}
            onChange={(event) => {
              if (event.target.value) setSelectedDate(new Date(`${event.target.value}T12:00:00`));
            }}
            className="w-auto"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1 lg:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search activities" aria-label="Search activities" />
          </div>
          <Button variant="outline" className="md:hidden" onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen}>
            <Filter className="h-4 w-4" /> Filters
          </Button>
          <div className="flex rounded-md border p-0.5" role="group" aria-label="Calendar view">
            {(["month", "week", "day"] as const).map((item) => (
              <Button key={item} size="sm" variant={view === item ? "secondary" : "ghost"} aria-pressed={view === item} onClick={() => setView(item)}>
                {item[0].toUpperCase() + item.slice(1)}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <aside className={cn("w-full shrink-0 rounded-lg border bg-card p-4 md:sticky md:top-16 md:w-56", filtersOpen ? "block" : "hidden md:block")} aria-label="Calendar filters">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Filters</h2>
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => {
              setSelectedTypes(activityTypeOptions.map((option) => option.value));
              setSelectedStatuses(statusOptions.map((option) => option.value));
              setSelectedPriorities(priorityOptions);
              setAssignedFilter("");
            }}>Reset</button>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-xs font-semibold text-muted-foreground">Activity type</legend>
            {activityTypeOptions.map(({ value, label, icon: Icon, dot }) => (
              <label key={value} className="flex cursor-pointer items-center gap-2 text-[13px]">
                <Checkbox checked={selectedTypes.includes(value)} onCheckedChange={() => toggleValue(selectedTypes, value, setSelectedTypes)} />
                <span className={cn("h-2 w-2 rounded-full", dot)} aria-hidden="true" />
                <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />{label}
              </label>
            ))}
          </fieldset>
          <fieldset className="mt-5 space-y-2 border-t pt-4">
            <legend className="mb-2 text-xs font-semibold text-muted-foreground">Status</legend>
            {statusOptions.map(({ value, label }) => (
              <label key={value} className="flex cursor-pointer items-center gap-2 text-[13px]">
                <Checkbox checked={selectedStatuses.includes(value)} onCheckedChange={() => toggleValue(selectedStatuses, value, setSelectedStatuses)} />
                {label}
              </label>
            ))}
          </fieldset>
          <fieldset className="mt-5 space-y-2 border-t pt-4">
            <legend className="mb-2 text-xs font-semibold text-muted-foreground">Priority</legend>
            {priorityOptions.map((value) => (
              <label key={value} className="flex cursor-pointer items-center gap-2 text-[13px]">
                <Checkbox checked={selectedPriorities.includes(value)} onCheckedChange={() => toggleValue(selectedPriorities, value, setSelectedPriorities)} />
                {value[0] + value.slice(1).toLowerCase()}
              </label>
            ))}
          </fieldset>
          <div className="mt-5 border-t pt-4">
            <Label htmlFor="assigned-filter" className="mb-2 block text-xs font-semibold text-muted-foreground">Assigned user</Label>
            <select id="assigned-filter" value={assignedFilter} onChange={(event) => setAssignedFilter(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs">
              <option value="">Everyone</option>
              {options.users.map((item) => <option key={item.id} value={item.id}>{item.firstName} {item.lastName}</option>)}
            </select>
          </div>
          <p className="mt-5 border-t pt-4 text-xs text-muted-foreground" aria-live="polite">
            {visibleActivities.length} {visibleActivities.length === 1 ? "activity" : "activities"} shown
          </p>
        </aside>

        <section className="min-w-0 flex-1 rounded-lg border bg-card shadow-sm" aria-label="Activity calendar">
          {loadError ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center">
              <div className="rounded-full bg-destructive/10 p-3 text-destructive"><X className="h-5 w-5" /></div>
              <div><h3 className="font-medium">Calendar unavailable</h3><p className="mt-1 text-sm text-muted-foreground">{loadError}</p></div>
              <Button variant="outline" onClick={() => void loadCalendar()}>Try again</Button>
            </div>
          ) : (
            <>
              {view === "month" ? (
                <div className="overflow-x-auto">
                  <div className="min-w-[740px]">
                    <div className="grid grid-cols-7 border-b bg-muted/30 text-center text-xs font-medium text-muted-foreground">
                      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <div key={day} className="px-2 py-2">{day}</div>)}
                    </div>
                    <div className="grid grid-cols-7">
                      {days.map((day) => {
                        const dayActivities = visibleActivities.filter((item) => isSameDay(new Date(item.start), day));
                        return (
                          <div
                            key={day.toISOString()}
                            onClick={() => {
                              const start = new Date(day);
                              start.setHours(9, 0, 0, 0);
                              openCreate(start);
                            }}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => handleDrop(event, day)}
                            className={cn(
                              "min-h-28 cursor-pointer border-b border-r p-1.5 transition-colors hover:bg-muted/30",
                              !isSameMonth(day, selectedDate) && "bg-muted/20 text-muted-foreground",
                              isToday(day) && "bg-primary/[0.035]"
                            )}
                          >
                            <div className={cn("mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs", isToday(day) && "bg-primary font-semibold text-primary-foreground")}>
                              {format(day, "d")}
                            </div>
                            <div className="space-y-1">
                              {dayActivities.slice(0, 4).map((activity) => (
                                <ActivityEvent key={activity.id} activity={activity} compact onOpen={openDetails} />
                              ))}
                              {dayActivities.length > 4 && <p className="px-1 text-[10px] text-muted-foreground">+{dayActivities.length - 4} more</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="overflow-auto">
                  <div className="min-w-[820px]">
                    <div className="grid border-b bg-muted/30" style={{ gridTemplateColumns: `64px repeat(${days.length}, minmax(140px, 1fr))` }}>
                      <div className="border-r" />
                      {days.map((day) => (
                        <button key={day.toISOString()} type="button" onClick={() => setSelectedDate(day)} className={cn("border-r px-2 py-2 text-center hover:bg-muted", isToday(day) && "text-primary")}>
                          <span className="block text-[11px] uppercase text-muted-foreground">{format(day, "EEE")}</span>
                          <span className={cn("mx-auto mt-1 flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium", isToday(day) && "bg-primary text-primary-foreground")}>{format(day, "d")}</span>
                        </button>
                      ))}
                    </div>
                    <div className="grid" style={{ gridTemplateColumns: `64px repeat(${days.length}, minmax(140px, 1fr))` }}>
                      <div className="select-none">
                        {Array.from({ length: 24 }, (_, hour) => (
                          <div key={hour} className="h-14 border-b px-2 pt-1 text-right text-[10px] text-muted-foreground">{format(new Date(2020, 0, 1, hour), "ha")}</div>
                        ))}
                      </div>
                      {days.map((day) => {
                        const dayEvents = visibleActivities
                          .filter((activity) => isSameDay(new Date(activity.start), day))
                          .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
                        const eventLanes: Array<{ activity: CalendarActivity; lane: number; laneCount: number }> = [];
                        let group: Array<{ activity: CalendarActivity; lane: number; end: number }> = [];
                        const flushGroup = () => {
                          const laneCount = Math.max(1, ...group.map((item) => item.lane + 1));
                          group.forEach((item) => eventLanes.push({ activity: item.activity, lane: item.lane, laneCount }));
                          group = [];
                        };
                        dayEvents.forEach((activity) => {
                          const start = new Date(activity.start).getTime();
                          const end = new Date(resizePreview?.id === activity.id ? resizePreview.end : activity.end).getTime();
                          if (group.length && group.every((item) => item.end <= start)) flushGroup();
                          let lane = 0;
                          while (group.some((item) => item.lane === lane && item.end > start)) lane += 1;
                          group.push({ activity, lane, end });
                        });
                        if (group.length) flushGroup();
                        return (
                          <div
                            key={day.toISOString()}
                            className="relative border-l"
                            style={{ height: 24 * 56 }}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => {
                              const hourCell = (event.target as HTMLElement).closest<HTMLElement>("[data-hour]");
                              const hour = hourCell ? Number(hourCell.dataset.hour) : undefined;
                              handleDrop(event, day, hour);
                            }}
                          >
                            {Array.from({ length: 24 }, (_, hour) => (
                              <button
                                key={hour}
                                type="button"
                                data-hour={hour}
                                aria-label={`Create activity ${format(day, "EEEE, MMMM d")} at ${format(new Date(2020, 0, 1, hour), "h a")}`}
                                onClick={() => {
                                  const start = new Date(day);
                                  start.setHours(hour, 0, 0, 0);
                                  openCreate(start);
                                }}
                                className="block h-14 w-full border-b border-dashed border-muted-foreground/20 text-left hover:bg-primary/[0.035]"
                              />
                            ))}
                            {eventLanes.map(({ activity, lane, laneCount }) => {
                              const start = new Date(activity.start);
                              const endValue = resizePreview?.id === activity.id ? resizePreview.end : activity.end;
                              const end = new Date(endValue);
                              const startMinutes = start.getHours() * 60 + start.getMinutes();
                              const endMinutes = Math.max(startMinutes + 20, end.getHours() * 60 + end.getMinutes());
                              const top = (startMinutes / 60) * 56;
                              const height = Math.max(27, ((endMinutes - startMinutes) / 60) * 56);
                              return (
                                <div key={activity.id} className="absolute z-10" style={{ top, height, left: `calc(${(lane / laneCount) * 100}% + 2px)`, width: `calc(${100 / laneCount}% - 4px)` }}>
                                  <ActivityEvent activity={activity} onOpen={openDetails} onResizeStart={startResize} />
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
              {loading && <div className="border-t px-4 py-2 text-xs text-muted-foreground" role="status">Updating calendar…</div>}
              {!loading && !visibleActivities.length && (
                <div className="border-t px-4 py-5 text-center text-sm text-muted-foreground">
                  {search || selectedTypes.length < activityTypeOptions.length || selectedStatuses.length < statusOptions.length || selectedPriorities.length < priorityOptions.length || assignedFilter
                    ? "No activities match the selected filters."
                    : "No activities in this period. Select a time slot or create a new activity."}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="left-auto right-0 top-0 h-dvh max-h-dvh w-full max-w-xl translate-x-0 translate-y-0 overflow-y-auto rounded-none p-0 sm:rounded-none">
          {dialogMode === "details" && activeActivity ? (
            <>
              <div className="border-b px-6 py-5 pr-12">
                <DialogHeader className="text-left">
                  <DialogDescription>{getTypeLabel(getType(activeActivity))} · {activeActivity.priority.toLowerCase()} priority</DialogDescription>
                  <DialogTitle className="text-xl">{activeActivity.title}</DialogTitle>
                </DialogHeader>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="outline">{statusOptions.find((item) => item.value === activeActivity.status)?.label}</Badge>
                  <Badge variant="outline">{getTypeLabel(getType(activeActivity))}</Badge>
                </div>
              </div>
              <div className="space-y-5 px-6 py-5">
                <DetailItem label="Date & time" value={`${displayDateTime(activeActivity.start)} – ${format(new Date(activeActivity.end), "h:mm a")}`} icon={CalendarDays} />
                <DetailItem label="Assigned to" value={assignedUserName(activeActivity)} icon={Users} />
                <DetailItem label="Created by" value={activeActivity.createdBy || "—"} icon={Users} />
                <DetailItem label="Related lead / customer" value={relatedName(activeActivity)} icon={Users} />
                <DetailItem label="Opportunity" value={activeActivity.opportunity?.name || "—"} icon={FileText} />
                <DetailItem label="Location" value={activeActivity.location || "—"} icon={MapPin} />
                {meetingUrl && (
                  <a
                    href={meetingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    Join meeting
                  </a>
                )}
                <DetailItem label="Description" value={activeActivity.description || "—"} />
                <DetailItem label="Notes" value={activeActivity.notes || "—"} />
                {activeActivity.reminderAt && <DetailItem label="Reminder" value={displayDateTime(activeActivity.reminderAt)} icon={Clock3} />}
              </div>
              <DialogFooter className="sticky bottom-0 mt-auto flex-row flex-wrap justify-between border-t bg-background px-6 py-4">
                <div className="flex gap-2">
                  {canDelete && <Button type="button" variant="destructive" onClick={() => void deleteActivity()}>Delete</Button>}
                  {canEdit && activeActivity.status !== "COMPLETED" && <Button type="button" variant="outline" onClick={() => void markCompleted()}><Check className="h-4 w-4" /> Mark complete</Button>}
                </div>
                {canEdit && <Button type="button" onClick={() => openEdit(activeActivity)}>Edit activity</Button>}
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={submitForm} className="flex min-h-full flex-col">
              <div className="border-b px-6 py-5 pr-12">
                <DialogHeader className="text-left">
                  <DialogTitle>{dialogMode === "edit" ? "Edit activity" : "New activity"}</DialogTitle>
                  <DialogDescription>{dialogMode === "edit" ? "Update the activity details and schedule." : "Add an activity to your shared CRM calendar."}</DialogDescription>
                </DialogHeader>
              </div>
              <div className="grid flex-1 gap-4 overflow-y-auto px-6 py-5 sm:grid-cols-2">
                <ActivityField label="Activity type">
                  <select required value={form.activityType} onChange={(event) => setForm((current) => ({ ...current, activityType: event.target.value as ActivityType }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[13px]">
                    {activityTypeOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </ActivityField>
                <ActivityField label="Title">
                  <Input required maxLength={200} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Add a clear activity title" />
                </ActivityField>
                <ActivityField label="Start date">
                  <Input required type="date" value={form.startDate} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} />
                </ActivityField>
                <ActivityField label="Start time">
                  <Input required type="time" value={form.startTime} onChange={(event) => setForm((current) => ({ ...current, startTime: event.target.value }))} />
                </ActivityField>
                <ActivityField label="End date">
                  <Input required type="date" value={form.endDate} onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} />
                </ActivityField>
                <ActivityField label="End time">
                  <Input required type="time" value={form.endTime} onChange={(event) => setForm((current) => ({ ...current, endTime: event.target.value }))} />
                </ActivityField>
                <ActivityField label="Assigned user">
                  <select value={form.assignedToId} onChange={(event) => setForm((current) => ({ ...current, assignedToId: event.target.value }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[13px]">
                    <option value="">Unassigned</option>
                    {options.users.map((item) => <option key={item.id} value={item.id}>{item.firstName} {item.lastName}</option>)}
                    {user && !options.users.some((item) => item.id === user.id) && <option value={user.id}>{user.firstName} {user.lastName} (you)</option>}
                  </select>
                </ActivityField>
                <ActivityField label="Related lead / customer">
                  <select value={form.leadId} onChange={(event) => setForm((current) => ({ ...current, leadId: event.target.value }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[13px]">
                    <option value="">None</option>
                    {options.leads.map((item) => <option key={item.id} value={item.id}>{[item.firstName, item.lastName].filter(Boolean).join(" ") || item.company}</option>)}
                  </select>
                </ActivityField>
                <ActivityField label="Related opportunity">
                  <select value={form.opportunityId} onChange={(event) => setForm((current) => ({ ...current, opportunityId: event.target.value }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[13px]">
                    <option value="">None</option>
                    {options.opportunities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </ActivityField>
                <ActivityField label="Location">
                  <Input maxLength={300} value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} placeholder="Office, property, or online" />
                </ActivityField>
                <ActivityField label="Meeting link">
                  <Input
                    type="url"
                    maxLength={2048}
                    value={form.meetingUrl}
                    onChange={(event) => setForm((current) => ({ ...current, meetingUrl: event.target.value }))}
                    placeholder="Paste meeting link (https://...)"
                  />
                </ActivityField>
                <ActivityField label="Priority">
                  <select value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value as ActivityPriority }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[13px]">
                    {priorityOptions.map((item) => <option key={item} value={item}>{item[0] + item.slice(1).toLowerCase()}</option>)}
                  </select>
                </ActivityField>
                <ActivityField label="Status">
                  <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as ActivityStatus }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[13px]">
                    {statusOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </ActivityField>
                <ActivityField label="Reminder">
                  <Input type="datetime-local" value={form.reminderAt} onChange={(event) => setForm((current) => ({ ...current, reminderAt: event.target.value }))} />
                </ActivityField>
                <ActivityField label="Description" className="sm:col-span-2">
                  <Textarea maxLength={5000} rows={3} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Add context for this activity" />
                </ActivityField>
                <ActivityField label="Notes" className="sm:col-span-2">
                  <Textarea maxLength={5000} rows={3} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Internal notes" />
                </ActivityField>
              </div>
              <DialogFooter className="sticky bottom-0 mt-auto border-t bg-background px-6 py-4">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={saving}>{saving ? "Saving…" : dialogMode === "edit" ? "Save changes" : "Create activity"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailItem({ label, value, icon: Icon }: { label: string; value: string; icon?: React.ElementType }) {
  return (
    <div className="flex gap-3">
      {Icon ? <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{value}</p>
      </div>
    </div>
  );
}
