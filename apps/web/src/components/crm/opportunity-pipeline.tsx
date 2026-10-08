"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { GripVertical, MoreHorizontal, Eye, Edit, Trash2 } from "lucide-react";
import type { OpportunityView } from "@/lib/opportunity";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type Opportunity = OpportunityView;

interface OpportunityPipelineProps {
  opportunities: Opportunity[];
  isLoading?: boolean;
  stages?: string[];
  onStageChange?: (opportunityId: string, newStage: string) => void;
}

const stageColors: Record<string, string> = {
  prospecting: "bg-blue-500",
  qualification: "bg-indigo-500",
  proposal: "bg-purple-500",
  negotiation: "bg-orange-500",
  "closed-won": "bg-green-500",
  "closed-lost": "bg-red-500",
};

const defaultStages = [
  "prospecting",
  "qualification",
  "proposal",
  "negotiation",
  "closed-won",
  "closed-lost",
];

const formatCurrency = (value: number, currency: string = "INR") => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency,
    maximumFractionDigits: 0,
  }).format(value);
};

export function OpportunityPipeline({
  opportunities,
  isLoading,
  stages = defaultStages,
  onStageChange,
}: OpportunityPipelineProps) {
  const [draggedItem, setDraggedItem] = React.useState<string | null>(null);

  const getOpportunitiesByStage = (stage: string) =>
    opportunities.filter((opp) => opp.stage === stage);

  const getStageTotal = (stage: string) =>
    getOpportunitiesByStage(stage).reduce((sum, opp) => sum + opp.value, 0);

  const handleDragStart = (e: React.DragEvent, opportunityId: string) => {
    setDraggedItem(opportunityId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, targetStage: string) => {
    e.preventDefault();
    if (draggedItem) {
      onStageChange?.(draggedItem, targetStage);
      setDraggedItem(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="min-w-[300px]">
            <Skeleton className="h-12 mb-4" />
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, j) => (
                <Skeleton key={j} className="h-24" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {stages.map((stage) => {
        const stageOpps = getOpportunitiesByStage(stage);
        const stageTotal = getStageTotal(stage);

        return (
          <div
            key={stage}
            className="min-w-[300px] flex-shrink-0"
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, stage)}
          >
            <div className="rounded-lg bg-muted/50 p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className={cn("h-3 w-3 rounded-full", stageColors[stage])} />
                  <h3 className="font-medium capitalize">{stage.replace("-", " ")}</h3>
                  <Badge variant="secondary" className="text-xs">
                    {stageOpps.length}
                  </Badge>
                </div>
                <span className="text-sm font-medium text-muted-foreground">
                  {formatCurrency(stageTotal)}
                </span>
              </div>
              <div className="space-y-3">
                {stageOpps.map((opportunity) => (
                  <div
                    key={opportunity.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, opportunity.id)}
                    className={cn(
                      "rounded-lg bg-card p-3 border cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow",
                      draggedItem === opportunity.id && "opacity-50"
                    )}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="min-w-0">
                        <Link
                          href={`/opportunities/${opportunity.id}`}
                          className="font-medium hover:underline line-clamp-1"
                        >
                          {opportunity.title}
                        </Link>
                        {opportunity.greRegistration && (
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            GRE {opportunity.greRegistration.referenceNumber || "submission"}
                            {opportunity.greRegistration.siteVisit.project
                              ? ` · ${opportunity.greRegistration.siteVisit.project}`
                              : ""}
                          </p>
                        )}
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6">
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
                          <DropdownMenuItem>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive">
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">
                      {opportunity.assignedTo}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {formatCurrency(opportunity.value, opportunity.currency)}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {opportunity.probability}%
                      </Badge>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      Close: {format(new Date(opportunity.closeDate), "MMM d, yyyy")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}