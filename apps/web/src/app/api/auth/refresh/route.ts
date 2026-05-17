import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.API_BASE_URL || 'http://api:4000';

export async function POST(req: NextRequest) {
  const body = await req.json() as { userId?: string };

  if (typeof body.userId !== 'string' || !body.userId.trim()) {
    const response = NextResponse.json({ message: 'Session expired' }, { status: 401 });
    response.cookies.delete('welfare_auth_token');
    response.cookies.delete('welfare_refresh_token');
    return response;
  }

  const refreshToken = req.cookies.get('welfare_refresh_token')?.value;

  if (!refreshToken) {
    const response = NextResponse.json({ message: 'Session expired' }, { status: 401 });
    response.cookies.delete('welfare_auth_token');
    response.cookies.delete('welfare_refresh_token');
    return response;
  }

  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: body.userId, refreshToken }),
  });

  if (!res.ok) {
    const response = NextResponse.json({ message: 'Session expired' }, { status: 401 });
    response.cookies.delete('welfare_auth_token');
    response.cookies.delete('welfare_refresh_token');
    return response;
  }

  const data = await res.json() as { accessToken: string; refreshToken: string };
  const response = NextResponse.json({ accessToken: data.accessToken });
  response.cookies.set('welfare_auth_token', data.accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60,
    path: '/',
  });
  response.cookies.set('welfare_refresh_token', data.refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60,
    path: '/',
  });
  return response;
}
