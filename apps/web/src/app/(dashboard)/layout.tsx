"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthProvider } from "@/contexts/auth-context";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import { Chatbot } from "@/components/ai/chatbot";
import { Toaster } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";

function ImpersonationBanner() {
  const { user, stopImpersonating } = useAuth();
  if (!user?.impersonatedBy) return null;

  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
      <span>You are logged in as <strong>{user.firstName} {user.lastName}</strong>.</span>
      <Button size="sm" variant="outline" onClick={() => void stopImpersonating()}>
        <LogOut className="mr-2 h-4 w-4" />
        Return to admin
      </Button>
    </div>
  );
}

function DashboardAccessGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isLoading, isAuthenticated, isSuperAdmin, isAdmin, hasFullAccess, hasEffectivePermission } = useAuth();

  const requiredPermission =
    pathname === "/leads/new" ? "LEAD_CREATE" :
    pathname.startsWith("/leads") ? "LEAD_READ" :
    pathname.startsWith("/tasks") ? "TASK_READ" :
    pathname.startsWith("/site-visits") ? "SITE_VISIT_READ" :
    pathname.startsWith("/opportunities") ? "OPPORTUNITY_READ" :
    pathname.startsWith("/quotations") ? "QUOTATION_READ" :
    pathname.startsWith("/bookings") ? "BOOKING_READ" :
    pathname.startsWith("/payments") ? "PAYMENT_READ" :
    pathname.startsWith("/projects") ? "PROJECT_READ" :
    pathname.startsWith("/dashboards") || pathname.startsWith("/dashboard/") ? "DASHBOARD_READ" :
    pathname.startsWith("/reports") ? "REPORT_VIEW" :
    null;

  const isCustomizeHomeRoute =
    pathname === "/admin/customize-home" ||
    pathname.startsWith("/admin/customize-home/");
  const isObjectManagerRoute =
    pathname === "/admin/object-manager" ||
    pathname.startsWith("/admin/object-manager/");
  const canManageObjects =
    isSuperAdmin || (isAdmin && (hasFullAccess || hasEffectivePermission("PROFILE_PERMISSION_MANAGE")));

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    } else if (!isLoading && requiredPermission && !(hasFullAccess || hasEffectivePermission(requiredPermission))) {
      router.replace("/home");
    } else if (!isLoading && pathname.startsWith("/setup") && !isAdmin && !isSuperAdmin) {
      router.replace("/home");
    } else if (!isLoading && isCustomizeHomeRoute && !isAdmin && !isSuperAdmin) {
      router.replace("/home");
    } else if (!isLoading && isObjectManagerRoute && !canManageObjects) {
      router.replace("/home");
    } else if (!isLoading && pathname.startsWith("/admin") && !isCustomizeHomeRoute && !isObjectManagerRoute && !isSuperAdmin) {
      router.replace("/home");
    }
  }, [canManageObjects, hasEffectivePermission, hasFullAccess, isAdmin, isLoading, isAuthenticated, isSuperAdmin, isCustomizeHomeRoute, isObjectManagerRoute, pathname, requiredPermission, router]);

  if (isLoading || !isAuthenticated) return null;
  if (requiredPermission && !(hasFullAccess || hasEffectivePermission(requiredPermission))) return null;
  if (pathname.startsWith("/setup") && !isAdmin && !isSuperAdmin) return null;
  if (isCustomizeHomeRoute && !isAdmin && !isSuperAdmin) return null;
  if (isObjectManagerRoute && !canManageObjects) return null;
  if (pathname.startsWith("/admin") && !isObjectManagerRoute && !isCustomizeHomeRoute && !isSuperAdmin) return null;
  return <>{children}</>;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const pathname = usePathname();
  const hideBreadcrumb = pathname === "/reports" || pathname.startsWith("/reports/");

  return (
    <AuthProvider>
      <div className="min-h-screen bg-background">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="lg:pl-64">
          <React.Suspense fallback={<div className="h-14" aria-hidden="true" />}>
            <Header onMenuClick={() => setSidebarOpen(true)} />
          </React.Suspense>
          <main className="p-4">
            {!hideBreadcrumb && <Breadcrumb className="mb-3" />}
            <ImpersonationBanner />
            <DashboardAccessGuard>
              <React.Suspense fallback={<div className="min-h-[40vh]" aria-hidden="true" />}>
                {children}
              </React.Suspense>
            </DashboardAccessGuard>
          </main>
        </div>
        <Chatbot />
        <Toaster />
      </div>
    </AuthProvider>
  );
}