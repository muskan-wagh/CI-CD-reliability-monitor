import { NextResponse } from "next/server";
import { apiForward } from "@/lib/api";

/** Create a GitHub issue for a test (proxied; App credentials stay server-side). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const out = await apiForward<{ number?: number; url?: string | null; error?: string; detail?: string }>(
    `/api/tests/${id}/issue`,
    "POST",
  );
  return NextResponse.json(out.body ?? { error: "empty_response" }, { status: out.status });
}
