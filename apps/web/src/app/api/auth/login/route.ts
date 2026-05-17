import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.API_BASE_URL || 'http://api:4000';

export async function POST(req: NextRequest) {
  const body = await req.json() as { username?: string; password?: string };

  if (
    typeof body.username !== 'string' ||
    typeof body.password !== 'string' ||
    !body.username.trim() ||
    !body.password
  ) {
    return NextResponse.json(
      { message: 'Username and password are required' },
      { status: 400 },
    );
  }

  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: body.username, password: body.password }),
  });

  if (!res.ok) {
    const error = await res.json() as { message?: string };
    return NextResponse.json(
      { message: error.message || 'Invalid credentials' },
      { status: res.status },
    );
  }

  const data = await res.json() as { accessToken: string; refreshToken: string };

  const response = NextResponse.json({ accessToken: data.accessToken });
  // Set access token cookie
  response.cookies.set('welfare_auth_token', data.accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60, // 8 hours — matches JWT expiry
    path: '/',
  });
  // Set refresh token cookie (httpOnly — not accessible to JS)
  response.cookies.set('welfare_refresh_token', data.refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60, // 7 days
    path: '/',
  });

  return response;
}
