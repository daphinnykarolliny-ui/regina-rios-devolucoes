import { NextResponse } from "next/server";
import { getHealthStatus } from "@/src/lib/health";

export function GET() {
  return NextResponse.json(getHealthStatus());
}
