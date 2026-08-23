import { NextResponse } from "next/server";
import { apiForward } from "@/lib/api";

/** Latest cached AI investigation for a test (proxied to the FlakyGuard API). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const out = await apiForward<unknown>(`/api/tests/${id}/investigation`, "GET");
  return NextResponse.json(out.body ?? { investigation: null }, { status: out.status });
}
