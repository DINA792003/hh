"use client";

import { formatDate, formatDateTime } from "@/lib/date-format";

import * as React from "react";

import { useParams, useRouter } from "next/navigation";

import Link from "next/link";

import { paymentApi } from "@/lib/api";

import { useToast } from "@/hooks/use-toast";

import { Badge } from "@/components/ui/badge";

import { Button } from "@/components/ui/button";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { Separator } from "@/components/ui/separator";

import { Skeleton } from "@/components/ui/skeleton";

import {
  ArrowLeft,
  Calendar,
  DollarSign,
  CreditCard,
  FileText,
  History,
  StickyNote,
  CheckCircle2,
  XCircle,
  ExternalLink,
} from "lucide-react";

interface PaymentData {
  id: string;
  paymentNumber: string;
  leadName: string;
  bookingNumber: string;
  amount: number;
  method: string;
  status: string;
  paymentDate: string;
  reference?: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info"> = {
  pending: "warning",
  completed: "success",
  failed: "destructive",
  refunded: "info",
  verified: "success",
  rejected: "destructive",
  partial: "warning",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  completed: "Completed",
  failed: "Failed",
  refunded: "Refunded",
  verified: "Verified",
  rejected: "Rejected",
  partial: "Partial",
};

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  cheque: "Cheque",
  online: "Online Transfer",
  emi: "EMI",
};

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
};

export default function PaymentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const [payment, setPayment] = React.useState<PaymentData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [activeTab, setActiveTab] = React.useState("details");

  React.useEffect(() => {
    const fetchPayment = async () => {
      try {
        setIsLoading(true);
        const res = await paymentApi.get(params.id as string);
        if (res.data.success && res.data.data) {
          const item = res.data.data;
          setPayment({
            id: item.id,
            paymentNumber: item.reference || item.id.slice(-8).toUpperCase(),
            leadName: item.booking?.lead
              ? `${item.booking.lead.firstName} ${item.booking.lead.lastName}`.trim()
              : "—",
            bookingNumber: item.booking?.number || "—",
            amount: item.amount || 0,
            method: (item.method || "online").toLowerCase(),
            status: (item.status || "pending").toLowerCase(),
            paymentDate: item.paymentDate || item.createdAt,
            reference: item.reference,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          });
        } else {
          toast({ title: "Error", description: "Payment not found", variant: "destructive" as any });
          router.push("/payments");
        }
      } catch {
        toast({ title: "Error", description: "Failed to load payment", variant: "destructive" as any });
      } finally {
        setIsLoading(false);
      }
    };
    fetchPayment();
  }, [params.id, router, toast]);

  const handleVerify = async () => {
    try {
      const res = await paymentApi.verify(params.id as string);
      if (res.data.success) {
        toast({ title: "Success", description: "Payment verified" });
        setPayment((prev) => (prev ? { ...prev, status: "completed" } : prev));
      }
    } catch {
      toast({ title: "Error", description: "Failed to verify payment", variant: "destructive" as any });
    }
  };

  const handleReject = async () => {
    try {
      const res = await paymentApi.reject(params.id as string, "Rejected by admin");
      if (res.data.success) {
        toast({ title: "Success", description: "Payment rejected" });
        setPayment((prev) => (prev ? { ...prev, status: "rejected" } : prev));
      }
    } catch {
      toast({ title: "Error", description: "Failed to reject payment", variant: "destructive" as any });
    }
  };

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
        <div className="grid gap-6 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
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

  if (!payment) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/payments">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{payment.paymentNumber}</h1>
            <p className="text-muted-foreground">Payment for {payment.leadName}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {payment.status === "pending" && (
            <>
              <Button onClick={handleVerify}>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Verify
              </Button>
              <Button variant="destructive" onClick={handleReject}>
                <XCircle className="mr-2 h-4 w-4" />
                Reject
              </Button>
            </>
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
                <p className="text-sm text-muted-foreground">Amount</p>
                <p className="text-lg font-bold">{formatCurrency(payment.amount)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <CheckCircle2 className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <Badge variant={STATUS_VARIANT[payment.status] || "default"}>
                  {STATUS_LABEL[payment.status] || payment.status}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <CreditCard className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Method</p>
                <p className="text-sm font-medium">{METHOD_LABEL[payment.method] || payment.method}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 rounded-lg">
                <Calendar className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Payment Date</p>
                <p className="text-sm font-medium">
                  {formatDate(payment.paymentDate)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="details" className="gap-2">
            <FileText className="h-4 w-4" />
            Details
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-2">
            <History className="h-4 w-4" />
            Activity
          </TabsTrigger>
          <TabsTrigger value="notes" className="gap-2">
            <StickyNote className="h-4 w-4" />
            Notes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Payment Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Payment Number</span>
                  <span className="text-sm font-medium">{payment.paymentNumber}</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Lead</span>
                  <span className="text-sm font-medium">{payment.leadName}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Booking</span>
                  <span className="text-sm font-medium">{payment.bookingNumber}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Amount</span>
                  <span className="text-sm font-bold">{formatCurrency(payment.amount)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Method</span>
                  <Badge variant="outline">{METHOD_LABEL[payment.method] || payment.method}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <Badge variant={STATUS_VARIANT[payment.status] || "default"}>
                    {STATUS_LABEL[payment.status] || payment.status}
                  </Badge>
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
                    <p className="text-sm font-medium">Payment Date</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(payment.paymentDate)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Created</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(payment.createdAt)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {payment.reference && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Reference
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-mono">{payment.reference}</span>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No activity recorded</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notes">
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <StickyNote className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No notes added</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
