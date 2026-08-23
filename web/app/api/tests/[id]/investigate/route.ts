import { NextResponse } from "next/server";
import { apiForward } from "@/lib/api";

/**
 * Trigger an AI failure investigation for a test.
 *
 * Long-running by design: free-tier models can take 30–60s on a cache miss
 * (identical evidence contexts are served from the backend's cache instead).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const out = await apiForward<unknown>(`/api/tests/${id}/investigate`, "POST");
  return NextResponse.json(out.body ?? { error: "empty_response" }, { status: out.status });
}
