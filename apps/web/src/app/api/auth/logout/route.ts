import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.API_BASE_URL || 'http://api:4000';

export async function POST(req: NextRequest) {
  const token = req.cookies.get('welfare_auth_token')?.value;

  if (token) {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => { /* best effort */ });
  }

  const response = NextResponse.json({ message: 'Logged out' });
  response.cookies.delete('welfare_auth_token');
  return response;
}
