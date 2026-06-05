import { NextResponse } from 'next/server';

const API_BASE = process.env.API_BASE_URL || 'http://api:4000';

export async function GET() {
  try {
    const res = await fetch(`${API_BASE}/config/public`, { cache: 'no-store' });
    if (!res.ok) return NextResponse.json({ adLoginEnabled: true });
    const data = await res.json() as { adLoginEnabled: boolean };
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ adLoginEnabled: true });
  }
}
