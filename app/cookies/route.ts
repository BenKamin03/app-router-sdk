import { NextRequest, NextResponse } from 'next/server';

export function GET(request: NextRequest) {
    const val = request.cookies.get("x-custom") || null;
    return NextResponse.json({ data: val });
}

export async function POST(request: NextRequest) {
    const val = request.cookies.get("x-custom") || null;
    return NextResponse.json({ data: val });
}