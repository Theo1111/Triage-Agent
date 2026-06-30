import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<NextResponse> {
  return new NextResponse(
    "PNG download is not implemented yet. This is a placeholder for future email snapshot export.",
    { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } }
  );
}
