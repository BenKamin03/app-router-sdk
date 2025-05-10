import { NextResponse } from "next/server";

export function GET() { return NextResponse.json({ data: "Hello Admin Settings GET" }); }