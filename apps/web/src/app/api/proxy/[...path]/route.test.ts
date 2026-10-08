import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

describe('API proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards the GRE session header to the backend', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const request = new NextRequest('http://localhost/api/proxy/api/gre/public/form/submit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gre-session': 'gre-session-token',
      },
      body: JSON.stringify({ draft: {} }),
    });

    await POST(request, {
      params: { path: ['api', 'gre', 'public', 'form', 'submit'] },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/gre/public/form/submit',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-gre-session': 'gre-session-token',
        }),
      }),
    );
  });
});
