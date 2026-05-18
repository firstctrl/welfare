import { NextRequest, NextResponse } from 'next/server';
import { apiClient } from '@/lib/api-client';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const { data: url } = await apiClient.get<string>(`/staff/${params.id}/photo`);
    return NextResponse.redirect(url);
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
