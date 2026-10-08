"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { opportunityApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";

const stages = [
  ["PROSPECTING", "Prospecting"],
  ["QUALIFICATION", "Qualification"],
  ["NEEDS_ANALYSIS", "Needs Analysis"],
  ["PROPOSAL", "Proposal"],
  ["NEGOTIATION", "Negotiation"],
  ["CLOSED_WON", "Closed Won"],
  ["CLOSED_LOST", "Closed Lost"],
] as const;

export default function NewOpportunityPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { hasEffectivePermission } = useAuth();
  const [name, setName] = React.useState("");
  const [stage, setStage] = React.useState("PROSPECTING");
  const [amount, setAmount] = React.useState("");
  const [probability, setProbability] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  if (!hasEffectivePermission("OPPORTUNITY_CREATE")) {
    return <p className="text-muted-foreground">You do not have permission to create opportunities.</p>;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      toast({ title: "Validation", description: "Opportunity name is required", variant: "destructive" as any });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await opportunityApi.create({
        name: name.trim(),
        stage,
        amount: amount ? Number(amount) : undefined,
        probability: probability ? Number(probability) : undefined,
        description: description.trim() || undefined,
      });
      if (!response.data.success || !response.data.data) {
        throw new Error(response.data.error || "Failed to create opportunity");
      }
      toast({ title: "Success", description: "Opportunity created successfully" });
      router.push(`/opportunities/${response.data.data.id}`);
    } catch (error: any) {
      toast({ title: "Error", description: error?.response?.data?.error || error.message || "Failed to create opportunity", variant: "destructive" as any });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/opportunities"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold">New Opportunity</h1>
          <p className="text-muted-foreground">Add a sales opportunity to the pipeline</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Opportunity Information</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="opportunity-name">Name</Label>
              <Input id="opportunity-name" value={name} onChange={(event) => setName(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="opportunity-stage">Stage</Label>
              <select id="opportunity-stage" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={stage} onChange={(event) => setStage(event.target.value)}>
                {stages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="opportunity-amount">Amount</Label>
              <Input id="opportunity-amount" type="number" min="0" value={amount} onChange={(event) => setAmount(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="opportunity-probability">Probability (%)</Label>
              <Input id="opportunity-probability" type="number" min="0" max="100" value={probability} onChange={(event) => setProbability(event.target.value)} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="opportunity-description">Description</Label>
              <Textarea id="opportunity-description" value={description} onChange={(event) => setDescription(event.target.value)} />
            </div>
          </CardContent>
        </Card>
        <div className="flex gap-3">
          <Button type="submit" disabled={isSubmitting}>{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create Opportunity</Button>
          <Button type="button" variant="outline" onClick={() => router.push("/opportunities")} disabled={isSubmitting}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
