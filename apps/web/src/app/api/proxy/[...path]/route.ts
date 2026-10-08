import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

async function proxyRequest(
  method: string,
  path: string,
  request: NextRequest
) {
  const cookieHeader = request.headers.get('cookie') || '';

  const headers: Record<string, string> = {
    cookie: cookieHeader,
  };

  const contentType = request.headers.get('content-type');
  if (contentType) {
    headers['content-type'] = contentType;
  }

  const greSessionHeader = request.headers.get('x-gre-session');
  if (greSessionHeader) {
    headers['x-gre-session'] = greSessionHeader;
  }

  const init: RequestInit = {
    method,
    headers,
  };

  if (method !== 'GET' && method !== 'HEAD') {
    init.body = await request.text();
  }

  const url = new URL(request.url);
  const searchParams = url.searchParams.toString();
  const targetUrl = `${BACKEND_URL}/${path}${searchParams ? `?${searchParams}` : ''}`;

  const response = await fetch(targetUrl, init);

  const responseDataContentType = response.headers.get('content-type') || '';
  const isBinary = responseDataContentType.startsWith('image/') ||
    responseDataContentType.startsWith('application/octet-stream') ||
    responseDataContentType.includes('pdf') ||
    responseDataContentType.includes('zip');

  let res: NextResponse;

  if (isBinary) {
    const buffer = Buffer.from(await response.arrayBuffer());
    res = new NextResponse(buffer, {
      status: response.status,
      statusText: response.statusText,
    });
  } else {
    const data = await response.text();
    res = new NextResponse(data, {
      status: response.status,
      statusText: response.statusText,
    });
  }

  const setCookieHeader = response.headers.get('set-cookie');
  if (setCookieHeader) {
    res.headers.set('set-cookie', setCookieHeader);
  }

  if (responseDataContentType) {
    res.headers.set('content-type', responseDataContentType);
  }

  return res;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const path = params.path.join('/');
    return await proxyRequest('GET', path, request);
  } catch (error) {
    console.error('Proxy GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Unable to connect to backend service' },
      { status: 502 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const path = params.path.join('/');
    return await proxyRequest('POST', path, request);
  } catch (error) {
    console.error('Proxy POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Unable to connect to backend service' },
      { status: 502 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const path = params.path.join('/');
    return await proxyRequest('PUT', path, request);
  } catch (error) {
    console.error('Proxy PUT error:', error);
    return NextResponse.json(
      { success: false, error: 'Unable to connect to backend service' },
      { status: 502 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const path = params.path.join('/');
    return await proxyRequest('DELETE', path, request);
  } catch (error) {
    console.error('Proxy DELETE error:', error);
    return NextResponse.json(
      { success: false, error: 'Unable to connect to backend service' },
      { status: 502 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const path = params.path.join('/');
    return await proxyRequest('PATCH', path, request);
  } catch (error) {
    console.error('Proxy PATCH error:', error);
    return NextResponse.json(
      { success: false, error: 'Unable to connect to backend service' },
      { status: 502 }
    );
  }
}
