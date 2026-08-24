import { NextResponse } from "next/server";
import { apiForward } from "@/lib/api";

/** Mute/quarantine a test (proxied; tenancy enforced by the API). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const out = await apiForward<unknown>(`/api/tests/${id}/mute`, "POST", body);
  return NextResponse.json(out.body ?? { error: "empty_response" }, { status: out.status });
}

/** Lift an active mute. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const out = await apiForward<unknown>(`/api/tests/${id}/mute`, "DELETE");
  return NextResponse.json(out.body ?? { error: "empty_response" }, { status: out.status });
}
