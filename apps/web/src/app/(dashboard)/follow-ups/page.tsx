"use client";

import * as React from "react";
import Link from "next/link";
import { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/crm/data-table";
import { FilterBar, FilterField } from "@/components/crm/filters";
import { MoreHorizontal, Eye, CheckCircle2, RotateCcw, Clock } from "lucide-react";
import { formatDateTime } from "@/lib/date-format";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { followUpApi } from "@/lib/api";

interface FollowUp {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  isCompleted: boolean;
  completedAt?: string;
  owner: string;
  leadId?: string;
  relatedTo?: string;
  relatedHref?: string;
}

const columns: ColumnDef<FollowUp>[] = [
  {
    accessorKey: "title",
    header: "Follow-up",
    cell: ({ row }) => {
      const item = row.original;
      return (
        <div>
          <span className="font-medium">{item.title}</span>
          {item.description && (
            <p className="text-sm text-muted-foreground line-clamp-1">{item.description}</p>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "dueDate",
    header: "Due Date",
    cell: ({ row }) => {
      const value = row.getValue("dueDate");
      if (!value) return "-";
      const date = new Date(value as string);
      const isOverdue = !row.original.isCompleted && date < new Date();
      return (
        <div className="flex items-center gap-1">
          <Clock className="h-4 w-4" />
          <span className={isOverdue ? "text-red-500" : ""}>{formatDateTime(date)}</span>
        </div>
      );
    },
  },
  {
    accessorKey: "isCompleted",
    header: "Status",
    cell: ({ row }) => {
      const completed = row.original.isCompleted;
      return (
        <Badge className={completed ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}>
          {completed ? "Completed" : "Open"}
        </Badge>
      );
    },
  },
  {
    accessorKey: "owner",
    header: "Owner",
  },
  {
    accessorKey: "relatedTo",
    header: "Related To",
    cell: ({ row }) => {
      const item = row.original;
      if (!item.relatedTo) return "-";
      if (!item.relatedHref) return item.relatedTo;
      return (
        <Link href={item.relatedHref} className="hover:underline text-primary">
          {item.relatedTo}
        </Link>
      );
    },
  },
];

function mapFollowUp(item: any): FollowUp {
  const owner = item.owner
    ? `${item.owner.firstName || ""} ${item.owner.lastName || ""}`.trim()
    : "";
  const leadName = item.lead
    ? `${item.lead.firstName || ""} ${item.lead.lastName || ""}`.trim() || item.lead.phone || undefined
    : undefined;
  return {
    id: item.id,
    title: item.title,
    description: item.description || "",
    dueDate: item.dueDate || "",
    isCompleted: Boolean(item.isCompleted),
    completedAt: item.completedAt || undefined,
    owner: owner || "-",
    leadId: item.leadId || undefined,
    relatedTo: leadName,
    relatedHref: item.leadId ? `/leads/${item.leadId}` : undefined,
  };
}

export default function FollowUpsPage() {
  const { toast } = useToast();
  const [currentPage, setCurrentPage] = React.useState(1);
  const [status, setStatus] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [followUps, setFollowUps] = React.useState<FollowUp[]>([]);
  const [totalItems, setTotalItems] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(true);
  const [actionId, setActionId] = React.useState("");

  const loadFollowUps = React.useCallback(async () => {
    try {
      setIsLoading(true);
      const params: Record<string, any> = { page: currentPage, limit: 20, sortBy: "dueDate", sortOrder: "asc" };
      if (status) params.isCompleted = status;
      if (search.trim()) params.search = search.trim();
      const res = await followUpApi.list(params);
      if (res.data.success && res.data.data) {
        setFollowUps(res.data.data.map(mapFollowUp));
        setTotalItems(res.data.pagination?.total ?? res.data.data.length);
      } else {
        setFollowUps([]);
        setTotalItems(0);
      }
    } catch (error: any) {
      setFollowUps([]);
      setTotalItems(0);
      toast({
        title: "Unable to load follow-ups",
        description: error?.response?.data?.error || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, search, status, toast]);

  React.useEffect(() => {
    void loadFollowUps();
  }, [loadFollowUps]);

  const toggleStatus = async (item: FollowUp) => {
    setActionId(item.id);
    try {
      const res = item.isCompleted
        ? await followUpApi.reopen(item.id)
        : await followUpApi.complete(item.id);
      if (res.data.success) {
        toast({
          title: item.isCompleted ? "Follow-up reopened" : "Follow-up completed",
          description: item.title,
        });
        await loadFollowUps();
      }
    } catch (error: any) {
      toast({
        title: "Unable to update follow-up",
        description: error?.response?.data?.error || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setActionId("");
    }
  };

  const renderActions = (item: FollowUp) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" disabled={actionId === item.id}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {item.relatedHref && (
          <DropdownMenuItem asChild>
            <Link href={item.relatedHref}>
              <Eye className="mr-2 h-4 w-4" />
              View lead
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => void toggleStatus(item)}>
          {item.isCompleted ? (
            <>
              <RotateCcw className="mr-2 h-4 w-4" />
              Reopen
            </>
          ) : (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Mark complete
            </>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const allColumns: ColumnDef<FollowUp>[] = [...columns, { id: "actions", cell: ({ row }) => renderActions(row.original) }];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Follow-ups</h1>
          <p className="text-muted-foreground">Track every open follow-up across your leads</p>
        </div>
      </div>

      <div className="space-y-4">
        <FilterBar
          onReset={() => {
            setStatus("");
            setSearch("");
            setCurrentPage(1);
          }}
        >
          <FilterField
            label="Status"
            type="select"
            value={status}
            onChange={(value) => {
              setStatus(value as string);
              setCurrentPage(1);
            }}
            options={[
              { label: "Open", value: "false" },
              { label: "Completed", value: "true" },
            ]}
            placeholder="All Statuses"
          />
          <FilterField
            label="Search"
            type="text"
            value={search}
            onChange={(value) => {
              setSearch(value as string);
              setCurrentPage(1);
            }}
            placeholder="Search follow-ups..."
          />
        </FilterBar>

        <DataTable
          columns={allColumns}
          data={followUps}
          isLoading={isLoading}
          searchKey="title"
          searchPlaceholder="Search follow-ups..."
          totalItems={totalItems}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          serverPagination
        />
      </div>
    </div>
  );
}
