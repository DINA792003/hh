"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/auth-context";
import {
  LayoutDashboard,
  Users,
  Contact,
  Building2,
  MapPin,
  TrendingUp,
  FileText,
  CalendarCheck,
  CalendarDays,
  CreditCard,
  FolderKanban,
  CheckSquare,
  BarChart3,
  FileCode2,
  Settings,
  ChevronRight,
  Clock3,
  X,
} from "lucide-react";

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function getNavigationByProfile(
  profileName: string | undefined,
  roles: string[],
  hasEffectivePermission: (perm: string) => boolean,
  isSuperAdmin: boolean,
  isAdmin: boolean
): NavItem[] {
  void roles;

  const nav: NavItem[] = [{ title: "Home", href: "/home", icon: LayoutDashboard }];

  if (isSuperAdmin) {
    nav.push({ title: "Companies", href: "/admin/companies", icon: Building2 });
  }

  if (hasEffectivePermission("LEAD_READ")) {
    nav.push({ title: "Leads", href: "/leads", icon: Contact });
  }
  if (hasEffectivePermission("SITE_VISIT_READ")) {
    nav.push({ title: "Site Visits", href: "/site-visits", icon: MapPin });
  }
  if (hasEffectivePermission("OPPORTUNITY_READ")) {
    nav.push({ title: "Opportunities", href: "/opportunities", icon: TrendingUp });
  }
  if (hasEffectivePermission("QUOTATION_READ")) {
    nav.push({ title: "Quotations", href: "/quotations", icon: FileText });
  }
  if (hasEffectivePermission("BOOKING_READ")) {
    nav.push({ title: "Bookings", href: "/bookings", icon: CalendarCheck });
  }
  if (hasEffectivePermission("PAYMENT_READ")) {
    nav.push({ title: "Payments", href: "/payments", icon: CreditCard });
  }
  if (profileName?.toLowerCase() !== "sales" && hasEffectivePermission("PROJECT_READ")) {
    nav.push({ title: "Projects", href: "/projects", icon: FolderKanban });
  }
  if (hasEffectivePermission("TASK_READ")) {
    nav.push({ title: "Tasks", href: "/tasks", icon: CheckSquare });
  }
  if (hasEffectivePermission("ACTIVITY_READ")) {
    nav.push({ title: "Calendar", href: "/calendar", icon: CalendarDays });
  }
  // Dashboards nav: admin-only per sidebar spec ("Presales/SVC must see ONLY
  // Home, Leads, Site Visits"). DASHBOARD_READ alone is NOT sufficient — every
  // profile holds it because the home page API (homepages.ts) requires it.
  if ((isSuperAdmin || isAdmin) && hasEffectivePermission("DASHBOARD_READ")) {
    nav.push({ title: "Dashboards", href: "/dashboards", icon: LayoutDashboard });
  }
  if (isAdmin && !isSuperAdmin) {
    nav.push({ title: "Pre Sales", href: "/profiles/pre-sales", icon: Users });
    nav.push({ title: "Sales", href: "/profiles/sales", icon: TrendingUp });
    nav.push({ title: "SVC", href: "/profiles/svc", icon: Users });
  }
  // Reports is always offered in the nav; actual report access is enforced
  // server-side by authorize('Report', 'read') on every reports endpoint.
  nav.push({ title: "Reports", href: "/reports", icon: BarChart3 });
  if (!isSuperAdmin && !isAdmin && hasEffectivePermission("FOLLOW_UP_READ")) {
    nav.push({ title: "Followups", href: "/follow-ups", icon: Clock3 });
  }

  if (isSuperAdmin || isAdmin) {
    nav.push({ title: "GRE Forms", href: "/setup/developer/gre", icon: FileCode2 });
    nav.push({ title: "Setup Home", href: "/setup", icon: Settings });
  }

  return nav;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { profile, roles, hasEffectivePermission, isSuperAdmin, isAdmin, tenant } = useAuth();

  const navigation = getNavigationByProfile(
    profile?.name,
    roles,
    hasEffectivePermission,
    isSuperAdmin,
    isAdmin
  );

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/80 lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 bg-card border-r transition-transform duration-300 ease-in-out lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          <Link href="/home" className="flex items-center gap-2">
            {tenant && (tenant as any).logo ? (
              <img
                src={`/api/proxy/api/super-admin/logos/${(tenant as any).logo}`}
                alt={tenant.name}
                className="h-7 w-7 rounded object-cover"
              />
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
                <span className="text-xs font-bold text-primary-foreground">DCT</span>
              </div>
            )}
            <span className="text-sm font-semibold">{isSuperAdmin ? "CRM" : tenant?.name || "CRM"}</span>
          </Link>
          <Button variant="ghost" size="icon" onClick={onClose} className="lg:hidden">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <ScrollArea className="h-[calc(100vh-3.5rem)] py-3">
          <nav className="space-y-0.5 px-2">
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                  isActive(item.href)
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground"
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.title}
                {isActive(item.href) && <ChevronRight className="ml-auto h-3.5 w-3.5" />}
              </Link>
            ))}
          </nav>
        </ScrollArea>
      </aside>
    </>
  );
}