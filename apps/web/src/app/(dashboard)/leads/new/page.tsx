"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { leadApi, projectApi, objectManagerApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
import LayoutDrivenForm from "@/components/admin/layout-driven-form";

interface Project {
  id: string;
  name: string;
}

const SOURCE_OPTIONS = [
  "WEBSITE",
  "REFERRAL",
  "COLD_CALL",
  "ADVERTISEMENT",
  "PORTAL",
  "INSTAGRAM",
  "TWITTER",
  "WHATSAPP",
  "YOUTUBE",
  "OTHER",
  "WALK_IN",
];

const LEAD_CREATE_SECTIONS = [
  {
    name: "Contact Information",
    fields: ["salutation", "firstName", "lastName", "title", "email", "phone", "mobile", "website"],
  },
  {
    name: "Company Information",
    fields: ["company", "industry", "annualRevenue", "numberOfEmployees"],
  },
  {
    name: "Lead Details",
    fields: ["projectId", "source", "status", "rating", "description"],
  },
  {
    name: "Address",
    fields: ["street", "city", "stateProvince", "country", "postalCode"],
  },
];

const REQUIRED_LEAD_FIELDS = new Set(["lastName", "company", "source", "phone"]);

function prepareLeadCreateLayout(layout: any) {
  let configuredSections: any[] = [];
  try {
    const sections = typeof layout?.sections === "string"
      ? JSON.parse(layout.sections)
      : layout?.sections;
    configuredSections = Array.isArray(sections) ? sections : [];
  } catch {
    configuredSections = [];
  }

  const standardFields = new Set(LEAD_CREATE_SECTIONS.flatMap((section) => section.fields));
  const customSections = configuredSections
    .map((section) => ({
      ...section,
      fields: Array.isArray(section.fields)
        ? section.fields.filter((field: string) => !standardFields.has(field))
        : [],
    }))
    .filter((section) => section.fields.length > 0);

  return {
    ...(layout || {}),
    sections: [...LEAD_CREATE_SECTIONS, ...customSections],
  };
}

export default function NewLeadPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = React.useState(true);
  const [layout, setLayout] = React.useState<any>(null);
  const [fields, setFields] = React.useState<any[]>([]);
  const [loadingLayout, setLoadingLayout] = React.useState(true);
  const [formData, setFormData] = React.useState<Record<string, any>>({
    source: "",
    status: "NEW",
  });
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    const loadData = async () => {
      try {
        const [projectsRes, layoutRes, fieldsRes] = await Promise.all([
          projectApi.listAll({ isActive: true }),
          objectManagerApi.getDefaultLayout("Lead"),
          objectManagerApi.listFields("Lead", { includeSystem: true }),
        ]);
        setProjects(projectsRes);
        setLayout(prepareLeadCreateLayout(layoutRes.data.data));
        setFields(
          (fieldsRes.data.data || []).map((field: any) =>
            REQUIRED_LEAD_FIELDS.has(field.name)
              ? {
                  ...field,
                  ...(field.name === "source" ? { label: "Lead Source" } : {}),
                  required: true,
                  visible: true,
                  editable: true,
                }
              : field
          )
        );
      } catch (err) {
        console.error("Failed to load data:", err);
      } finally {
        setLoadingProjects(false);
        setLoadingLayout(false);
      }
    };
    loadData();
  }, []);

  const validate = (): boolean => {
    const errors: string[] = [];
    const nextFieldErrors: Record<string, string> = {};
    if (!formData.lastName?.trim()) errors.push("Last name is required");
    if (!formData.company?.trim()) errors.push("Company is required");
    if (!SOURCE_OPTIONS.includes(formData.source)) {
      errors.push("Lead Source is required.");
      nextFieldErrors.source = "Lead Source is required.";
    }
    if (!String(formData.phone ?? "").trim()) {
      errors.push("Phone number is required.");
      nextFieldErrors.phone = "Phone number is required.";
    }
    setFieldErrors(nextFieldErrors);
    if (errors.length > 0) {
      setError(errors.join(". "));
      return false;
    }
    return true;
  };

  const handleFieldChange = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setError(null);
    if (field === "phone") {
      setFieldErrors((prev) => {
        if (!prev.phone) return prev;
        const { phone: _phone, ...rest } = prev;
        return rest;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const payload: Record<string, any> = {};
      for (const [key, value] of Object.entries(formData)) {
        if (value !== null && value !== undefined && value !== "") {
          payload[key] = value;
        }
      }

      const response = await leadApi.create(payload);
      const assignmentWarning = response.data?.data?.assignmentWarning;
      toast(assignmentWarning
        ? { title: "Lead created, assignment pending", description: assignmentWarning, variant: "destructive" }
        : { title: "Success", description: "Lead created successfully" });
      router.push("/leads");
    } catch (err: any) {
      const message =
        err?.response?.data?.error || err?.response?.data?.message || err?.message || "Failed to create lead";
      if (message === "Phone number already exists for another lead.") {
        setFieldErrors({ phone: message });
      }
      setError(message);
      toast({ title: "Error", description: message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isLoading = loadingLayout || loadingProjects;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/leads">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Create Lead</h1>
          <p className="text-muted-foreground">Add a new lead</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-6">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <div className="h-5 w-40 bg-muted animate-pulse rounded-md" />
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="h-10 bg-muted animate-pulse rounded-md" />
                    <div className="h-10 bg-muted animate-pulse rounded-md" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <LayoutDrivenForm
            objectName="Lead"
            mode="create"
            data={formData}
            onChange={handleFieldChange}
            layout={layout}
            fields={fields}
            projects={projects}
            fieldErrors={fieldErrors}
          />
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isSubmitting || isLoading}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Lead
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/leads")}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}