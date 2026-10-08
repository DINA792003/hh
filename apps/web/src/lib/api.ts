import axios, { AxiosInstance, AxiosError } from 'axios';
import type { OpportunityApiRecord } from './opportunity';

const API_BASE_URL = '/api/proxy';

const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Anonymous client for the public GRE registration links. Those endpoints answer
// 401/410 for a missing or expired form session, which the form handles itself —
// it must not be bounced to /login the way authenticated API calls are.
const publicApi: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

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

// Auth API
export const authApi = {
  login: (email: string, password: string) =>
    api.post<ApiResponse>('/api/auth/login', { email, password }),
  logout: () => api.post<ApiResponse>('/api/auth/logout'),
  me: () => api.get<ApiResponse>('/api/auth/me'),
  stopImpersonation: () => api.post<ApiResponse>('/api/auth/stop-impersonation'),
};

// Lead API
export const leadApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/leads', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/leads/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/leads', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/leads/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/leads/${id}`),
  updateStatus: (id: string, status: string, note: string) =>
    api.put<ApiResponse>(`/api/leads/${id}/status`, { status, note }),
  recovery: (id: string, data: { recoveryReason: string; note?: string }) =>
    api.post<ApiResponse>(`/api/leads/${id}/move-to-recovery`, data),
  changeOwner: (id: string, ownerId: string, reason: string) =>
    api.patch<ApiResponse>(`/api/leads/${id}/owner`, { ownerId, reason }),
  ownerCandidates: (id: string) =>
    api.get<ApiResponse>(`/api/leads/${id}/owner-candidates`),
  pushToSVC: (id: string, data: { reason: string }) =>
    api.post<ApiResponse>(`/api/leads/${id}/push-to-svc`, data),
  moveToRecovery: (id: string, data: { recoveryReason: string; note?: string }) =>
    api.post<ApiResponse>(`/api/leads/${id}/move-to-recovery`, data),
  scheduleSiteVisit: (id: string, data: { scheduledAt: string; notes: string; projectId?: string }) =>
    api.post<ApiResponse>(`/api/leads/${id}/schedule-site-visit`, data),
  convert: (id: string, data?: { projectId?: string; unitId?: string; name?: string; amount?: number; expectedCloseDate?: string; probability?: number; description?: string }) =>
    api.post<ApiResponse>(`/api/leads/${id}/convert`, data || {}),
  getAuditHistory: (id: string, params?: Record<string, any>) =>
    api.get<ApiResponse>(`/api/leads/${id}/audit-history`, { params }),
};

// Site Visit API
export const siteVisitApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/site-visits', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/site-visits/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/site-visits', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/site-visits/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/site-visits/${id}`),
  complete: (id: string, data: {
    completedAt: string;
    customerFeedback: string;
    completionNotes: string;
    latitude: number;
    longitude: number;
  }) =>
    api.patch<ApiResponse>(`/api/site-visits/${id}/complete`, data || {}),
  cancel: (id: string, reason: string) =>
    api.patch<ApiResponse>(`/api/site-visits/${id}/cancel`, { reason }),
  revisit: (id: string, data: { reason: string; scheduledAt: string; projectId: string; assigneeId?: string; notes?: string }) =>
    api.post<ApiResponse>(`/api/site-visits/${id}/revisit`, data),
};

// Opportunity API
export const opportunityApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse<OpportunityApiRecord[]>>('/api/opportunities', { params }),
  get: (id: string) =>
    api.get<ApiResponse<OpportunityApiRecord>>(`/api/opportunities/${id}`),
  create: (data: any) =>
    api.post<ApiResponse<OpportunityApiRecord>>('/api/opportunities', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse<OpportunityApiRecord>>(`/api/opportunities/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/opportunities/${id}`),
  updateStage: (id: string, stage: string) =>
    api.patch<ApiResponse>(`/api/opportunities/${id}/stage`, { stage }),
};

// Quotation API
export const quotationApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/quotations', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/quotations/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/quotations', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/quotations/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/quotations/${id}`),
  downloadPdf: (id: string) =>
    api.get(`/api/quotations/${id}/pdf`, { responseType: 'blob' }),
  submit: (id: string) =>
    api.patch<ApiResponse>(`/api/quotations/${id}/submit`),
  approve: (id: string, comments?: string) =>
    api.patch<ApiResponse>(`/api/quotations/${id}/approve`, { comments }),
  reject: (id: string, comments?: string) =>
    api.patch<ApiResponse>(`/api/quotations/${id}/reject`, { comments }),
};

// Booking API
export const bookingApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/bookings', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/bookings/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/bookings', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/bookings/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/bookings/${id}`),
  confirm: (id: string) =>
    api.patch<ApiResponse>(`/api/bookings/${id}/confirm`),
  cancel: (id: string, notes?: string) =>
    api.patch<ApiResponse>(`/api/bookings/${id}/cancel`, { notes }),
};

// Payment API
export const paymentApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/payments', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/payments/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/payments', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/payments/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/payments/${id}`),
  verify: (id: string) =>
    api.patch<ApiResponse>(`/api/payments/${id}/verify`),
  reject: (id: string, reason?: string) =>
    api.patch<ApiResponse>(`/api/payments/${id}/reject`, { reason }),
};

// Project API
export const projectApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/projects', { params }),
  listAll: async (params?: Record<string, any>) => {
    const limit = 100;
    const firstPage = await api.get<ApiResponse<any[]>>('/api/projects', { params: { ...params, page: 1, limit } });
    const firstProjects = firstPage.data.data || [];
    const totalPages = firstPage.data.pagination?.totalPages || 1;
    const remainingPages = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, index) =>
        api.get<ApiResponse<any[]>>('/api/projects', { params: { ...params, page: index + 2, limit } })
      )
    );
    return [...firstProjects, ...remainingPages.flatMap((response) => response.data.data || [])];
  },
  get: (id: string) =>
    api.get<ApiResponse>(`/api/projects/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/projects', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/projects/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/projects/${id}`),
};

// Unit API
export const unitApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/units', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/units/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/units', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/units/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/units/${id}`),
  updateStatus: (id: string, status: string) =>
    api.patch<ApiResponse>(`/api/units/${id}/status`, { status }),
};

// Task API
export const taskApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/tasks', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/tasks/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/tasks', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/tasks/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/tasks/${id}`),
  updateStatus: (id: string, status: string) =>
    api.put<ApiResponse>(`/api/tasks/${id}/status`, { status }),
  getMy: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/tasks/my', { params }),
};

// Follow-up API
export const followUpApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/follow-ups', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/follow-ups/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/follow-ups', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/follow-ups/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/follow-ups/${id}`),
  complete: (id: string) =>
    api.put<ApiResponse>(`/api/follow-ups/${id}/complete`),
  reopen: (id: string) =>
    api.put<ApiResponse>(`/api/follow-ups/${id}/reopen`),
};

// Activity API
export const activityApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/activities', { params }),
  summary: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/activities/summary', { params }),
  options: () =>
    api.get<ApiResponse>('/api/activities/options'),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/activities/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/activities', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/activities/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/activities/${id}`),
};

// Object Definition API
export const objectDefinitionApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/objects', { params }),
  get: (name: string) =>
    api.get<ApiResponse>(`/api/objects/${name}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/objects', data),
  update: (name: string, data: any) =>
    api.put<ApiResponse>(`/api/objects/${name}`, data),
  delete: (name: string) =>
    api.delete<ApiResponse>(`/api/objects/${name}`),
  fields: (objectName: string, params?: { includeSystem?: boolean; includeInactive?: boolean }) =>
    api.get<ApiResponse>(`/api/fields/${objectName}`, { params }),
};

// Data Administration API
export const dataAdministrationApi = {
  import: (objectName: string, fields: string[], csv: string) =>
    api.post<ApiResponse>('/api/data-administration/import', { objectName, fields, csv }),
  export: (objectName: string, params?: Record<string, any>) =>
    api.get(`/api/data-administration/export/${objectName}`, {
      params,
      responseType: 'text',
      headers: { Accept: 'text/csv' },
    }),
};

// Report API
export const reportApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/reports', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/reports/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/reports', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/reports/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/reports/${id}`),
  execute: (id: string, params?: Record<string, any>) =>
    api.post<ApiResponse>(`/api/reports/${id}/execute`, params),
};

// Dashboard API
export const dashboardApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/dashboards', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/dashboards/${id}`),
  getDefault: () =>
    api.get<ApiResponse>('/api/dashboards/default'),
  create: (data: any) =>
    api.post<ApiResponse>('/api/dashboards', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/dashboards/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/dashboards/${id}`),
  getWidgetData: (id: string, widgetId: string, filters?: any) =>
    api.post<ApiResponse>(`/api/dashboards/${id}/widgets/${widgetId}/data`, { filters }),
};

// Search API
export const searchApi = {
  search: (query: string, params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/search', { params: { q: query, ...params } }),
  quick: (query: string) =>
    api.get<ApiResponse>('/api/search/quick', { params: { q: query } }),
};

// Analytics API
export const analyticsApi = {
  getLeads: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/analytics/leads', { params }),
  getOpportunities: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/analytics/opportunities', { params }),
  getBookings: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/analytics/bookings', { params }),
  getPayments: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/analytics/payments', { params }),
  getProjects: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/analytics/projects', { params }),
  getPipeline: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/analytics/pipeline', { params }),
};

// AI API
export const aiApi = {
  chat: (message: string, conversationId?: string) =>
    api.post<ApiResponse>('/api/ai/chat', { message, conversation_id: conversationId }),
  getConversation: (id: string) =>
    api.get<ApiResponse>(`/api/ai/conversations/${id}`),
  listConversations: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/ai/conversations', { params }),
  deleteConversation: (id: string) =>
    api.delete<ApiResponse>(`/api/ai/conversations/${id}`),
};

// User API
export const userApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/setup/users', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/setup/users/${id}`),
  create: (data: {
    email: string;
    firstName: string;
    lastName?: string;
    phone?: string;
    profileId?: string;
    roleId?: string | null;
    roleIds?: string[];
    password?: string;
    isActive?: boolean;
  }) =>
    api.post<ApiResponse>('/api/setup/users', data),
  update: (
    id: string,
    data: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      profileId?: string | null;
      roleId?: string | null;
      roleIds?: string[];
      isActive?: boolean;
    }
  ) =>
    api.put<ApiResponse>(`/api/setup/users/${id}`, data),
  assignRoles: (id: string, roleIds: string[]) =>
    api.put<ApiResponse>(`/api/setup/users/${id}/roles`, { roleIds }),
  deactivate: (id: string) =>
    api.put<ApiResponse>(`/api/setup/users/${id}/deactivate`),
  activate: (id: string) =>
    api.put<ApiResponse>(`/api/setup/users/${id}/activate`),
  resetPassword: (id: string, password: string) =>
    api.put<ApiResponse>(`/api/setup/users/${id}/password`, { password }),
  impersonate: (id: string) =>
    api.post<ApiResponse>(`/api/setup/users/${id}/impersonate`),
};

// Role API
export const roleApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/roles', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/roles/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/roles', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/roles/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/roles/${id}`),
};

// Notification API
export const notificationApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/notifications', { params }),
  markRead: (id: string) =>
    api.put<ApiResponse>(`/api/notifications/${id}/read`),
  markAllRead: () =>
    api.put<ApiResponse>('/api/notifications/read-all'),
  getUnreadCount: () =>
    api.get<ApiResponse>('/api/notifications/unread-count'),
  clearAll: () =>
    api.delete<ApiResponse>('/api/notifications/clear-all'),
};

// Audit API
export const auditApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/audit', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/audit/${id}`),
  getByObject: (type: string, objectId: string, params?: Record<string, any>) =>
    api.get<ApiResponse>(`/api/audit/object/${type}/${objectId}`, { params }),
  getByUser: (userId: string) =>
    api.get<ApiResponse>(`/api/audit/user/${userId}`),
  getSummary: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/audit/summary', { params }),
};

// Object Manager API
export const objectManagerApi = {
  listObjects: (includeInactive?: boolean) =>
    api.get<ApiResponse>('/api/objects', { params: { includeInactive } }),
  getObject: (name: string) =>
    api.get<ApiResponse>(`/api/objects/${name}`),
  createObject: (data: any) =>
    api.post<ApiResponse>('/api/objects', data),
  updateObject: (name: string, data: any) =>
    api.put<ApiResponse>(`/api/objects/${name}`, data),
  deleteObject: (name: string) =>
    api.delete<ApiResponse>(`/api/objects/${name}`),

  listFields: (objectName: string, params?: { includeSystem?: boolean; includeInactive?: boolean }) =>
    api.get<ApiResponse>(`/api/fields/${objectName}`, { params }),
  getField: (objectName: string, fieldId: string) =>
    api.get<ApiResponse>(`/api/fields/${objectName}/${fieldId}`),
  createField: (objectName: string, data: any) =>
    api.post<ApiResponse>(`/api/fields/${objectName}`, data),
  updateField: (objectName: string, fieldId: string, data: any) =>
    api.put<ApiResponse>(`/api/fields/${objectName}/${fieldId}`, data),
  toggleField: (objectName: string, fieldId: string) =>
    api.patch<ApiResponse>(`/api/fields/${objectName}/${fieldId}/toggle`),
  reorderFields: (objectName: string, fieldOrders: { id: string; displayOrder: number }[]) =>
    api.patch<ApiResponse>(`/api/fields/${objectName}/reorder`, { fieldOrders }),
  deleteField: (objectName: string, fieldId: string) =>
    api.delete<ApiResponse>(`/api/fields/${objectName}/${fieldId}`),

  listPicklistValues: (fieldId: string) =>
    api.get<ApiResponse>(`/api/picklist-values/${fieldId}`),
  createPicklistValue: (fieldId: string, data: any) =>
    api.post<ApiResponse>(`/api/picklist-values/${fieldId}`, data),
  updatePicklistValue: (fieldId: string, valueId: string, data: any) =>
    api.put<ApiResponse>(`/api/picklist-values/${fieldId}/${valueId}`, data),
  deletePicklistValue: (fieldId: string, valueId: string) =>
    api.delete<ApiResponse>(`/api/picklist-values/${fieldId}/${valueId}`),

  listLayouts: (objectName: string) =>
    api.get<ApiResponse>(`/api/setup/layouts/${objectName}`),
  getDefaultLayout: (objectName: string) =>
    api.get<ApiResponse>(`/api/setup/layouts/${objectName}/default`),
  createLayout: (objectName: string, data: any) =>
    api.post<ApiResponse>(`/api/setup/layouts/${objectName}`, data),
  updateLayout: (objectName: string, layoutId: string, data: any) =>
    api.put<ApiResponse>(`/api/setup/layouts/${objectName}/${layoutId}`, data),
  deleteLayout: (objectName: string, layoutId: string) =>
    api.delete<ApiResponse>(`/api/setup/layouts/${objectName}/${layoutId}`),

  getObjectPermissions: (objectName: string) =>
    api.get<ApiResponse>(`/api/object-permissions/${objectName}`),
  setObjectPermissions: (objectName: string, data: any) =>
    api.post<ApiResponse>(`/api/object-permissions/${objectName}`, data),
  bulkSetObjectPermissions: (objectName: string, permissions: any[]) =>
    api.post<ApiResponse>(`/api/object-permissions/${objectName}/bulk`, { permissions }),
  deleteObjectPermission: (objectName: string, permissionId: string) =>
    api.delete<ApiResponse>(`/api/object-permissions/${objectName}/${permissionId}`),

  getFieldPermissions: (objectName: string, roleId?: string) =>
    api.get<ApiResponse>(`/api/field-permissions/${objectName}`, { params: { roleId } }),
  setFieldPermissions: (objectName: string, data: any) =>
    api.post<ApiResponse>(`/api/field-permissions/${objectName}`, data),
  bulkSetFieldPermissions: (objectName: string, permissions: any[]) =>
    api.post<ApiResponse>(`/api/field-permissions/${objectName}/bulk`, { permissions }),
  deleteFieldPermission: (objectName: string, permissionId: string) =>
    api.delete<ApiResponse>(`/api/field-permissions/${objectName}/${permissionId}`),

};

// Modules API
export const modulesApi = {
  list: (includeInactive = true) =>
    api.get<ApiResponse>('/api/setup/modules', { params: { includeInactive } }),
  create: (data: any) => api.post<ApiResponse>('/api/setup/modules', data),
  update: (name: string, data: any) => api.put<ApiResponse>(`/api/setup/modules/${name}`, data),
  delete: (name: string) => api.delete<ApiResponse>(`/api/setup/modules/${name}`),
};

// Fields API
export const fieldsApi = {
  list: (moduleName: string, includeInactive = true) =>
    api.get<ApiResponse>(`/api/setup/fields/${moduleName}`, { params: { includeInactive } }),
  create: (moduleName: string, data: any) => api.post<ApiResponse>(`/api/setup/fields/${moduleName}`, data),
  update: (moduleName: string, fieldId: string, data: any) => api.put<ApiResponse>(`/api/setup/fields/${moduleName}/${fieldId}`, data),
  toggle: (moduleName: string, fieldId: string) => api.patch<ApiResponse>(`/api/setup/fields/${moduleName}/${fieldId}/toggle`),
};

// Dynamic Record API
export const dynamicRecordApi = {
  list: (objectName: string, params?: Record<string, any>) =>
    api.get<ApiResponse>(`/api/records/${objectName}`, { params }),
  get: (objectName: string, id: string) =>
    api.get<ApiResponse>(`/api/records/${objectName}/${id}`),
  create: (objectName: string, data: any) =>
    api.post<ApiResponse>(`/api/records/${objectName}`, data),
  update: (objectName: string, id: string, data: any) =>
    api.put<ApiResponse>(`/api/records/${objectName}/${id}`, data),
  delete: (objectName: string, id: string) =>
    api.delete<ApiResponse>(`/api/records/${objectName}/${id}`),
  bulkCreate: (objectName: string, records: any[]) =>
    api.post<ApiResponse>(`/api/records/${objectName}/bulk`, { records }),
};

// Profile API
export const profileApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/profiles', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/profiles/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/profiles', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/profiles/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/profiles/${id}`),
};

// Permission Catalog API
export const permissionApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/permissions', { params }),
  getModules: () =>
    api.get<ApiResponse>('/api/permissions/modules'),
};

// New PermissionSet API (effective permission system)
export const newPermissionSetApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/new-permission-sets', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/new-permission-sets/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/new-permission-sets', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/new-permission-sets/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/new-permission-sets/${id}`),
  assign: (id: string, userIds: string[]) =>
    api.post<ApiResponse>(`/api/new-permission-sets/${id}/assign`, { userIds }),
  unassign: (id: string, userId: string) =>
    api.delete<ApiResponse>(`/api/new-permission-sets/${id}/assign/${userId}`),
};

// User Permissions API (direct permissions + permission set assignments)
export const userPermissionApi = {
  getDirectPermissions: (userId: string) =>
    api.get<ApiResponse>(`/api/user-permissions/${userId}/direct-permissions`),
  addDirectPermissions: (userId: string, permissionIds: string[]) =>
    api.post<ApiResponse>(`/api/user-permissions/${userId}/direct-permissions`, { permissionIds }),
  removeDirectPermission: (userId: string, permissionId: string) =>
    api.delete<ApiResponse>(`/api/user-permissions/${userId}/direct-permissions/${permissionId}`),
  getUserPermissionSets: (userId: string) =>
    api.get<ApiResponse>(`/api/user-permissions/${userId}/permission-sets`),
  assignPermissionSets: (userId: string, permissionSetIds: string[]) =>
    api.post<ApiResponse>(`/api/user-permissions/${userId}/permission-sets`, { permissionSetIds }),
  unassignPermissionSet: (userId: string, permissionSetId: string) =>
    api.delete<ApiResponse>(`/api/user-permissions/${userId}/permission-sets/${permissionSetId}`),
};

// Permission Set Groups API
export const permissionSetGroupApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/permission-set-groups', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/permission-set-groups/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/permission-set-groups', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/permission-set-groups/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/permission-set-groups/${id}`),
  assignPermissionSets: (groupId: string, permissionSetIds: string[]) =>
    api.post<ApiResponse>(`/api/permission-set-groups/${groupId}/permission-sets`, { permissionSetIds }),
  removePermissionSet: (groupId: string, permissionSetId: string) =>
    api.delete<ApiResponse>(`/api/permission-set-groups/${groupId}/permission-sets/${permissionSetId}`),
};

// User Permission Set Groups API
export const userPermissionSetGroupApi = {
  list: (userId: string) =>
    api.get<ApiResponse>(`/api/user-permission-set-groups/${userId}`),
  assign: (userId: string, groupIds: string[]) =>
    api.post<ApiResponse>(`/api/user-permission-set-groups/${userId}`, { groupIds }),
  unassign: (userId: string, groupId: string) =>
    api.delete<ApiResponse>(`/api/user-permission-set-groups/${userId}/${groupId}`),
};

// Effective Permissions API
export const effectivePermissionApi = {
  getMine: () =>
    api.get<ApiResponse>('/api/effective-permissions/me'),
  getUserPermissions: (userId: string) =>
    api.get<ApiResponse>(`/api/effective-permissions/user/${userId}`),
  check: (permissionName: string) =>
    api.get<ApiResponse>(`/api/effective-permissions/check/${permissionName}`),
};

// Profile Permissions API
export const profilePermissionApi = {
  getPermissions: (profileId: string) =>
    api.get<ApiResponse>(`/api/profile-permissions/${profileId}/permissions`),
  setPermissions: (profileId: string, permissionIds: string[]) =>
    api.put<ApiResponse>(`/api/profile-permissions/${profileId}/permissions`, { permissionIds }),
  addPermissions: (profileId: string, permissionIds: string[]) =>
    api.post<ApiResponse>(`/api/profile-permissions/${profileId}/permissions`, { permissionIds }),
  removePermission: (profileId: string, permissionId: string) =>
    api.delete<ApiResponse>(`/api/profile-permissions/${profileId}/permissions/${permissionId}`),
};

// Profile Security API
export const profileSecurityApi = {
  get: (profileId: string) => api.get<ApiResponse>(`/api/profile-security/${profileId}/security`),
  update: (profileId: string, data: any) => api.put<ApiResponse>(`/api/profile-security/${profileId}/security`, data),
};

// Company Settings API
export const companySettingsApi = {
  get: () => api.get<ApiResponse>('/api/setup/company-settings'),
  update: (data: any) => api.put<ApiResponse>('/api/setup/company-settings', data),
};

// Personal Settings API
export const personalSettingsApi = {
  get: () => api.get<ApiResponse>('/api/setup/personal-settings'),
  update: (data: any) => api.put<ApiResponse>('/api/setup/personal-settings', data),
};

export default api;

// Company Management API (Super Admin)
export const companyApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/super-admin/companies', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/super-admin/companies/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/super-admin/companies', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/super-admin/companies/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/super-admin/companies/${id}`),
  activate: (id: string) =>
    api.put<ApiResponse>(`/api/super-admin/companies/${id}/activate`),
  deactivate: (id: string) =>
    api.put<ApiResponse>(`/api/super-admin/companies/${id}/deactivate`),
  uploadLogo: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('logo', file);
    return api.post<ApiResponse>(`/api/super-admin/companies/${id}/logo`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  removeLogo: (id: string) =>
    api.delete<ApiResponse>(`/api/super-admin/companies/${id}/logo`),
  getCapacity: (id: string) =>
    api.get<ApiResponse>(`/api/super-admin/companies/${id}/capacity`),
  updateCapacity: (id: string, data: { maxTotalUsers?: number; maxAdminUsers?: number }) =>
    api.put<ApiResponse>(`/api/super-admin/companies/${id}/capacity`, data),
  updatePackage: (id: string, data: { packageName?: string | null; packageStatus?: string; packageStartDate?: string | null; packageExpiryDate?: string | null; packageNotes?: string | null }) =>
    api.put<ApiResponse>(`/api/super-admin/companies/${id}/package`, data),
};

// Customize Home (Homepage layouts per profile)
export const homepageApi = {
  list: () =>
    api.get<ApiResponse>('/api/homepages'),
  assigned: () =>
    api.get<ApiResponse>('/api/homepages/assigned'),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/homepages/${id}`),
  create: (data: { name: string; description?: string; layout: Array<string | { id: string; x: number; y: number; width: number; height: number }>; profileIds: string[] }) =>
    api.post<ApiResponse>('/api/homepages', data),
  update: (id: string, data: { name: string; description?: string; layout: Array<string | { id: string; x: number; y: number; width: number; height: number }>; profileIds: string[] }) =>
    api.put<ApiResponse>(`/api/homepages/${id}`, data),
  updateStatus: (id: string, isActive: boolean) =>
    api.patch<ApiResponse>(`/api/homepages/${id}/status`, { isActive }),
};

export const rrQueueApi = {
  list: (params?: Record<string, string>) => api.get<ApiResponse>('/api/rrqueues', { params }),
  options: () => api.get<ApiResponse>('/api/rrqueues/options'),
  get: (id: string) => api.get<ApiResponse>(`/api/rrqueues/${id}`),
  create: (data: { name: string; leadStatus: string[]; projectInterested: string[]; excludeFromNoSource: string[]; presalesQueue: boolean; ownerId?: string | null; leadCount?: number; previousId?: number }) => api.post<ApiResponse>('/api/rrqueues', data),
  update: (id: string, data: Partial<{ name: string; leadStatus: string[]; projectInterested: string[]; excludeFromNoSource: string[]; presalesQueue: boolean; ownerId: string | null }>) => api.put<ApiResponse>(`/api/rrqueues/${id}`, data),
  remove: (id: string) => api.delete<ApiResponse>(`/api/rrqueues/${id}`),
  members: (id: string, params?: Record<string, number>) => api.get<ApiResponse>(`/api/rrqueues/${id}/members`, { params }),
  member: (id: string, memberId: string) => api.get<ApiResponse>(`/api/rrqueues/${id}/members/${memberId}`),
  addMember: (id: string, data: { userId: string; userIdNumber?: string | null }) => api.post<ApiResponse>(`/api/rrqueues/${id}/members`, data),
  updateMember: (id: string, memberId: string, data: { activeMember?: boolean; userId?: string; userIdNumber?: string | null }) => api.put<ApiResponse>(`/api/rrqueues/${id}/members/${memberId}`, data),
  setMemberActive: (id: string, memberId: string, activeMember: boolean) => api.put<ApiResponse>(`/api/rrqueues/${id}/members/${memberId}`, { activeMember }),
  removeMember: (id: string, memberId: string) => api.delete<ApiResponse>(`/api/rrqueues/${id}/members/${memberId}`),
  history: (id: string, params?: Record<string, number>) => api.get<ApiResponse>(`/api/rrqueues/${id}/history`, { params }),
  assign: (id: string, leadId: string) => api.post<ApiResponse>(`/api/rrqueues/${id}/assign`, { leadId }),
};

// GRE (General Registration Enquiry) API
const greSessionHeaders = (sessionToken: string) => ({ 'x-gre-session': sessionToken });

export const greApi = {
  // Setup (admin)
  listForms: () => api.get<ApiResponse>('/api/gre/forms'),
  createForm: (data: { name: string; defaultProjectId?: string | null; expiresAt?: string | null }) =>
    api.post<ApiResponse>('/api/gre/forms', data),
  updateForm: (id: string, data: { name?: string; isActive?: boolean; defaultProjectId?: string | null; expiresAt?: string | null }) =>
    api.patch<ApiResponse>(`/api/gre/forms/${id}`, data),
  listSubmissions: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/gre/submissions', { params }),

  // Public registration form
  getPublicForm: (token: string) =>
    publicApi.get<ApiResponse>(`/api/gre/public/${token}`),
  startPublicSession: (token: string, data: { countryCode: string; phone: string; alternatePhone?: string }) =>
    publicApi.post<ApiResponse>(`/api/gre/public/${token}/sessions`, data),
  getPublicSession: (token: string, sessionToken: string) =>
    publicApi.get<ApiResponse>(`/api/gre/public/${token}/session`, { headers: greSessionHeaders(sessionToken) }),
  submitPublicSession: (token: string, sessionToken: string, draft: any) =>
    publicApi.post<ApiResponse>(`/api/gre/public/${token}/submit`, { draft }, { headers: greSessionHeaders(sessionToken) }),
};