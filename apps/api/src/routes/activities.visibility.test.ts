import { describe, expect, it } from 'vitest';
import { calendarActivityVisibilityFilter } from './activities';

describe('calendar activity visibility', () => {
  it('limits regular users to activities they created or are assigned', () => {
    expect(calendarActivityVisibilityFilter({ id: 'user-a' })).toEqual({
      OR: [{ userId: 'user-a' }, { assignedToId: 'user-a' }],
    });
  });

  it('allows admins to view all tenant activities', () => {
    expect(calendarActivityVisibilityFilter({ id: 'admin', isAdmin: true })).toEqual({});
    expect(calendarActivityVisibilityFilter({ id: 'super-admin', isSuperAdmin: true })).toEqual({});
  });
});
