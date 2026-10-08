import { z } from 'zod';

export const PHONE_DUPLICATE_ERROR = 'Phone number already exists for another lead.';
const CRM_TIMEZONE = 'Asia/Kolkata';

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getCRMFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-IN', { ...options, timeZone: CRM_TIMEZONE });
    formatterCache.set(key, formatter);
  }
  return formatter;
}

export function formatCRMDate(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return getCRMFormatter({ day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

export function formatCRMDateTime(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return getCRMFormatter({
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function crmLocalDateTimeToDate(date: string, time: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !timeMatch) throw new Error('Invalid CRM date/time');
  const [, year, month, day] = match;
  const [, hour, minute] = timeMatch;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)) - 330 * 60 * 1000);
}

export function crmDateToUtcStart(date: string): Date {
  return crmLocalDateTimeToDate(date, '00:00');
}

export function crmDateTimeInputValue(value = new Date()): string {
  const parts = getCRMFormatter({
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

export function getCRMDayBounds(now = new Date()): { start: Date; end: Date } {
  const parts = getCRMFormatter({
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const start = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)) - 330 * 60 * 1000);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

export function normalizePhone(raw: string): string {
  return raw.replace(/\s+/g, '');
}

// ============================================
// AUTH SCHEMAS
// ============================================

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

// ============================================
// CRM SCHEMAS
// ============================================

export const leadSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string({
    required_error: 'Last name is required',
    invalid_type_error: 'Last name is required',
  }).trim().min(1, 'Last name is required'),
  salutation: z.enum(['MR', 'MS', 'MRS', 'DR', 'PROF']).optional(),
  title: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string({
    required_error: 'Phone number is required.',
    invalid_type_error: 'Phone number is required.',
  }).trim().min(1, 'Phone number is required.').transform(normalizePhone),
  mobile: z.string().optional(),
  website: z.string().url().optional().or(z.literal('')),
  company: z.string({
    required_error: 'Company is required',
    invalid_type_error: 'Company is required',
  }).trim().min(1, 'Company is required'),
  industry: z.enum(['TECHNOLOGY', 'HEALTHCARE', 'FINANCE', 'EDUCATION', 'MANUFACTURING', 'RETAIL', 'REAL_ESTATE', 'CONSTRUCTION', 'HOSPITALITY', 'AUTOMOTIVE', 'ENERGY', 'TELECOMMUNICATIONS', 'MEDIA', 'GOVERNMENT', 'OTHER']).optional(),
  annualRevenue: z.number().optional(),
  numberOfEmployees: z.number().optional(),
  source: z.enum(['WEBSITE', 'REFERRAL', 'COLD_CALL', 'ADVERTISEMENT', 'WALK_IN', 'PORTAL', 'INSTAGRAM', 'TWITTER', 'WHATSAPP', 'YOUTUBE', 'OTHER'], {
    required_error: 'Lead Source is required.',
    invalid_type_error: 'Lead Source is required.',
  }),
  status: z.enum(['NEW', 'INCOMING', 'PROSPECT', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_HAPPENED', 'BOOKED', 'LOST']).optional(),
  rating: z.enum(['HOT', 'WARM', 'COLD']).optional(),
  description: z.string().optional(),
  street: z.string().optional(),
  city: z.string().optional(),
  stateProvince: z.string().optional(),
  country: z.string().optional(),
  postalCode: z.string().optional(),
  score: z.number().optional(),
  budget: z.number().optional(),
  requirements: z.string().optional(),
  notes: z.string().optional(),
  ownerId: z.string().optional(),
  projectId: z.string().nullable().optional(),
}).strict();

export const leadCreateSchema = leadSchema.omit({
  ownerId: true,
});

export const leadUpdateSchema = leadSchema.partial().strip();

export const siteVisitSchema = z.object({
  leadId: z.string().min(1),
  projectId: z.string().min(1, 'Project is required'),
  assigneeId: z.string().optional(),
  scheduledAt: z.string().datetime(),
  notes: z.string().min(1, 'Note/reason is required'),
});

export const opportunitySchema = z.object({
  name: z.string().min(1),
  stage: z.enum(['PROSPECTING', 'QUALIFICATION', 'NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST']).default('PROSPECTING'),
  amount: z.number().optional(),
  expectedCloseDate: z.string().optional(),
  probability: z.number().min(0).max(100).optional(),
  description: z.string().optional(),
  leadId: z.string().optional(),
  ownerId: z.string().optional(),
  projectId: z.string().optional(),
});

export const quotationSchema = z.object({
  opportunityId: z.string().optional(),
  leadId: z.string().optional(),
  projectId: z.string().optional(),
  totalAmount: z.number().min(0),
  taxAmount: z.number().optional(),
  discount: z.number().optional(),
  validUntil: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(z.object({
    unitId: z.string().optional(),
    description: z.string().min(1),
    quantity: z.number().min(1).default(1),
    unitPrice: z.number().min(0),
    totalPrice: z.number().min(0),
  })),
});

export const bookingSchema = z.object({
  leadId: z.string().optional(),
  opportunityId: z.string().optional(),
  quotationId: z.string().optional(),
  projectId: z.string().min(1),
  unitId: z.string().min(1),
  ownerId: z.string().optional(),
  totalAmount: z.number().min(0),
  notes: z.string().optional(),
});

export const paymentSchema = z.object({
  bookingId: z.string().min(1),
  amount: z.number().min(0.01),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

export const projectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  totalUnits: z.number().optional(),
});

export const unitSchema = z.object({
  projectId: z.string().min(1),
  number: z.string().min(1),
  type: z.string().optional(),
  floor: z.number().optional(),
  area: z.number().optional(),
  price: z.number().optional(),
  status: z.enum(['AVAILABLE', 'HOLD', 'RESERVED', 'BOOKED', 'SOLD', 'BLOCKED']).default('AVAILABLE'),
});

export const taskSchema = z.object({
  title: z.string().min(1, 'Title/Description is required'),
  description: z.string().min(1, 'Description is required'),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).default('PENDING'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  dueDate: z.string().min(1, 'Due date is required'),
  leadId: z.string().optional(),
  siteVisitId: z.string().optional(),
  opportunityId: z.string().optional(),
});

export const followUpSchema = z.object({
  title: z.string().min(1, 'Title/Note is required'),
  description: z.string().min(1, 'Description/Note is required'),
  dueDate: z.string().min(1, 'Due date is required'),
  leadId: z.string().optional(),
});

export const activitySchema = z.object({
  type: z.enum(['CALL', 'MEETING', 'WHATSAPP', 'EMAIL', 'SITE_VISIT', 'NOTE', 'TASK', 'FOLLOW_UP', 'SYSTEM', 'SCHEDULE', 'MEMO']),
  subject: z.string().trim().min(1, 'Subject is required').max(200),
  description: z.string().trim().max(5000).optional(),
  dueDate: z.string().optional(),
  leadId: z.string().min(1).nullable().optional(),
  customerId: z.string().min(1).nullable().optional(),
  siteVisitId: z.string().min(1).nullable().optional(),
  opportunityId: z.string().min(1).nullable().optional(),
  bookingId: z.string().min(1).nullable().optional(),
  startAt: z.string().datetime({ offset: true }).nullable().optional(),
  endAt: z.string().datetime({ offset: true }).nullable().optional(),
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  assignedToId: z.string().min(1).nullable().optional(),
  location: z.string().trim().max(300).nullable().optional(),
  meetingUrl: z.string().trim().max(2048).url('Meeting link must be a valid URL').refine(
    (value) => /^https?:\/\//i.test(value),
    'Meeting link must use http or https',
  ).nullable().optional(),
  reminderAt: z.string().datetime({ offset: true }).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
});

// ============================================
// API RESPONSE TYPES
// ============================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ============================================
// SEARCH TYPES
// ============================================

export interface SearchResult {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  url: string;
  tenantId: string;
}