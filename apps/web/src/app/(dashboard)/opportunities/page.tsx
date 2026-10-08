"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { OpportunityPipeline, Opportunity } from "@/components/crm/opportunity-pipeline";

import { DataTable } from "@/components/crm/data-table";

import { ColumnDef } from "@tanstack/react-table";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";

import { Skeleton } from "@/components/ui/skeleton";

import { Plus, LayoutGrid, List, MoreHorizontal, Eye } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useToast } from "@/hooks/use-toast";

import { opportunityApi } from "@/lib/api";
import { mapOpportunity } from "@/lib/opportunity";

import { useAuth } from "@/contexts/auth-context";

import { formatDate } from "@/lib/date-format";

const stageColors: Record<string, string> = {
  prospecting: "bg-blue-100 text-blue-800",
  qualification: "bg-indigo-100 text-indigo-800",
  proposal: "bg-purple-100 text-purple-800",
  negotiation: "bg-orange-100 text-orange-800",
  "closed-won": "bg-green-100 text-green-800",
  "closed-lost": "bg-red-100 text-red-800",
};

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
};

const listColumns: ColumnDef<Opportunity>[] = [
  {
    accessorKey: "title",
    header: "Opportunity",
    cell: ({ row }) => (
      <Link href={`/opportunities/${row.original.id}`} className="hover:underline font-medium">
        {row.getValue("title")}
      </Link>
    ),
  },
  {
    id: "greRegistration",
    header: "GRE Registration",
    cell: ({ row }) => {
      const registration = row.original.greRegistration;
      if (!registration) return "—";
      const customerName = [registration.lead.firstName, registration.lead.lastName]
        .filter(Boolean)
        .join(" ");
      return (
        <div className="min-w-36">
          <p className="font-medium">{registration.referenceNumber || "GRE submission"}</p>
          <p className="text-xs text-muted-foreground">
            {[customerName, registration.siteVisit.project].filter(Boolean).join(" · ") || "Registration details"}
          </p>
        </div>
      );
    },
  },
  {
    accessorKey: "value",
    header: "Value",
    cell: ({ row }) => formatCurrency(row.getValue("value") as number),
  },
  {
    accessorKey: "stage",
    header: "Stage",
    cell: ({ row }) => {
      const stage = row.getValue("stage") as string;
      return (
        <Badge className={stageColors[stage] || "bg-gray-100 text-gray-800"}>
          {stage.replace("-", " ")}
        </Badge>
      );
    },
  },
  {
    accessorKey: "probability",
    header: "Probability",
    cell: ({ row }) => `${row.getValue("probability")}%`,
  },
  {
    accessorKey: "closeDate",
    header: "Close Date",
    cell: ({ row }) => formatDate(row.getValue("closeDate") as string),
  },
  {
    accessorKey: "assignedTo",
    header: "Assigned To",
  },
  {
    id: "actions",
    cell: ({ row }) => {
      const opportunity = row.original;
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/opportunities/${opportunity.id}`}>
                <Eye className="mr-2 h-4 w-4" />
                View
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];

export default function OpportunitiesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { hasEffectivePermission } = useAuth();
  const [view, setView] = React.useState<"pipeline" | "list">("pipeline");
  const [currentPage, setCurrentPage] = React.useState(1);
  const [opportunities, setOpportunities] = React.useState<Opportunity[]>([]);
  const [totalItems, setTotalItems] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const fetchOpportunities = async () => {
      try {
        setIsLoading(true);
        const res = await opportunityApi.list({ page: currentPage, limit: 20 });
        if (res.data.success && res.data.data) {
          const mapped = res.data.data.map(mapOpportunity);
          setOpportunities(mapped);
          setTotalItems(res.data.pagination?.total ?? mapped.length);
        } else {
          setOpportunities([]);
          setTotalItems(0);
        }
      } catch {
        toast({ title: "Error", description: "Failed to load opportunities", variant: "destructive" as any });
        setOpportunities([]);
        setTotalItems(0);
      } finally {
        setIsLoading(false);
      }
    };
    fetchOpportunities();
  }, [currentPage, toast]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Opportunities</h1>
          <p className="text-muted-foreground">
            Track and manage sales opportunities
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={view} onValueChange={(value) => setView(value as "pipeline" | "list")}>
            <TabsList>
              <TabsTrigger value="pipeline" className="gap-2">
                <LayoutGrid className="h-4 w-4" />
                Pipeline
              </TabsTrigger>
              <TabsTrigger value="list" className="gap-2">
                <List className="h-4 w-4" />
                List
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {hasEffectivePermission("OPPORTUNITY_CREATE") && (
            <Button onClick={() => router.push("/opportunities/new")}>
              <Plus className="mr-2 h-4 w-4" />
              New Opportunity
            </Button>
          )}
        </div>
      </div>

      {view === "pipeline" ? (
        <OpportunityPipeline
          opportunities={opportunities}
          onStageChange={async (opportunityId, newStage) => {
            if (!hasEffectivePermission("OPPORTUNITY_UPDATE")) return;
            try {
              await opportunityApi.updateStage(opportunityId, newStage.toUpperCase().replace(/-/g, "_"));
              setOpportunities((current) => current.map((item) => item.id === opportunityId ? { ...item, stage: newStage } : item));
            } catch {
              toast({ title: "Error", description: "Failed to update opportunity stage", variant: "destructive" as any });
            }
          }}
        />
      ) : (
        <DataTable
          columns={listColumns}
          data={opportunities}
          searchKey="title"
          searchPlaceholder="Search opportunities..."
            totalItems={totalItems}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            serverPagination
          />
      )}
    </div>
  );
}