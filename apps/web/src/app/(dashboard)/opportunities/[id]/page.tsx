"use client";

import { formatDate, formatDateTime } from "@/lib/date-format";

import * as React from "react";

import { useParams, useRouter } from "next/navigation";

import { cn } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";

import { Button } from "@/components/ui/button";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { Separator } from "@/components/ui/separator";

import { Skeleton } from "@/components/ui/skeleton";

import Link from "next/link";

import { useToast } from "@/hooks/use-toast";

import { opportunityApi } from "@/lib/api";
import { mapOpportunity } from "@/lib/opportunity";
import type { OpportunityView } from "@/lib/opportunity";
import { useAuth } from "@/contexts/auth-context";

import {
  ArrowLeft,
  Trash2,
  DollarSign,
  Calendar,
  User,
  Building2,
  TrendingUp,
  FileText,
  History,
  CheckSquare,
} from "lucide-react";

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

const stages = ["prospecting", "qualification", "needs-analysis", "proposal", "negotiation", "closed-won"];

export default function OpportunityDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { hasEffectivePermission } = useAuth();
  const [opportunity, setOpportunity] = React.useState<OpportunityView | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const fetchOpportunity = async () => {
      try {
        setIsLoading(true);
        const res = await opportunityApi.get(params.id as string);
        if (res.data.success && res.data.data) {
          setOpportunity(mapOpportunity(res.data.data));
        } else {
          toast({ title: "Error", description: "Opportunity not found", variant: "destructive" as any });
          router.push("/opportunities");
        }
      } catch {
        toast({ title: "Error", description: "Failed to load opportunity", variant: "destructive" as any });
      } finally {
        setIsLoading(false);
      }
    };
    fetchOpportunity();
  }, [params.id, router, toast]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="grid gap-6 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!opportunity) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/opportunities">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-bold">{opportunity.title}</h1>
            <p className="text-muted-foreground">{opportunity.assignedTo}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {hasEffectivePermission("OPPORTUNITY_DELETE") && (
            <Button
              variant="destructive"
              onClick={async () => {
                try {
                  await opportunityApi.delete(opportunity.id);
                  toast({ title: "Deleted", description: "Opportunity deleted" });
                  router.push("/opportunities");
                } catch {
                  toast({ title: "Error", description: "Failed to delete opportunity", variant: "destructive" as any });
                }
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Value</p>
                <p className="text-lg font-bold">{formatCurrency(opportunity.value)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <TrendingUp className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Stage</p>
                <Badge className={cn("capitalize", stageColors[opportunity.stage])}>
                  {opportunity.stage.replace("-", " ")}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 rounded-lg">
                <CheckSquare className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Probability</p>
                <p className="text-lg font-bold">{opportunity.probability}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Calendar className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Close Date</p>
                <p className="text-lg font-bold">
                  {formatDate(opportunity.closeDate)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pipeline Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between mb-2">
            {stages.map((stage, index) => (
              <React.Fragment key={stage}>
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      "h-10 w-10 rounded-full flex items-center justify-center text-sm font-medium",
                      stages.indexOf(opportunity.stage) >= index
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {index + 1}
                  </div>
                  <span className="text-xs mt-1 capitalize">{stage.replace("-", " ")}</span>
                </div>
                {index < stages.length - 1 && (
                  <div
                    className={cn(
                      "flex-1 h-1 mx-2",
                      stages.indexOf(opportunity.stage) > index
                        ? "bg-primary"
                        : "bg-muted"
                    )}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        </CardContent>
      </Card>

      {opportunity.greRegistration && (
        <Card>
          <CardHeader>
            <CardTitle>Latest GRE Registration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm text-muted-foreground">Reference</p>
                <p className="font-medium">{opportunity.greRegistration.referenceNumber || "GRE submission"}</p>
              </div>
              {opportunity.greRegistration.submittedAt && (
                <div>
                  <p className="text-sm text-muted-foreground">Submitted</p>
                  <p className="text-sm">{formatDateTime(opportunity.greRegistration.submittedAt)}</p>
                </div>
              )}
              {opportunity.lead && (
                <Link className="text-sm text-primary hover:underline" href={`/leads/${opportunity.lead.id}`}>
                  {opportunity.lead.leadNumber || "Open Lead"}
                </Link>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <p className="text-sm text-muted-foreground">Customer</p>
                <p className="font-medium">
                  {[opportunity.greRegistration.lead.firstName, opportunity.greRegistration.lead.lastName]
                    .filter(Boolean)
                    .join(" ") || "—"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Phone</p>
                <p className="font-medium">{opportunity.greRegistration.lead.phone || "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Email</p>
                <p className="font-medium">{opportunity.greRegistration.lead.email || "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Company</p>
                <p className="font-medium">
                  {opportunity.greRegistration.company.name || opportunity.greRegistration.lead.company || "—"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Project</p>
                <p className="font-medium">{opportunity.greRegistration.siteVisit.project || "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Site Visit</p>
                <p className="font-medium">
                  {[opportunity.greRegistration.siteVisit.date, opportunity.greRegistration.siteVisit.time]
                    .filter(Boolean)
                    .join(" ") || (opportunity.greRegistration.siteVisit.scheduledAt
                      ? formatDateTime(opportunity.greRegistration.siteVisit.scheduledAt)
                      : "—")}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Visit Type</p>
                <p className="font-medium">{opportunity.greRegistration.siteVisit.visitType || "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Visitors</p>
                <p className="font-medium">{opportunity.greRegistration.siteVisit.visitorCount ?? "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Budget</p>
                <p className="font-medium">
                  {opportunity.greRegistration.lead.budget == null
                    ? "—"
                    : formatCurrency(opportunity.greRegistration.lead.budget)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="details" className="space-y-4">
        <TabsList>
          <TabsTrigger value="details" className="gap-2">
            <FileText className="h-4 w-4" />
            Details
          </TabsTrigger>
          <TabsTrigger value="activities" className="gap-2">
            <History className="h-4 w-4" />
            Activities
          </TabsTrigger>
          <TabsTrigger value="notes" className="gap-2">
            <FileText className="h-4 w-4" />
            Notes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Opportunity Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Title</span>
                  <span className="text-sm font-medium">{opportunity.title}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Value</span>
                  <span className="text-sm font-medium">{formatCurrency(opportunity.value)}</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Assigned To</span>
                  <span className="text-sm font-medium">{opportunity.assignedTo}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Timeline
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Created</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(opportunity.createdAt)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Expected Close</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(opportunity.closeDate)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {opportunity.description && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Description
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{opportunity.description}</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="activities">
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No activities recorded</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notes">
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No notes added</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}