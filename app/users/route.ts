import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const postSchema = z.object({ userName: z.string() });

export function GET() { return NextResponse.json({ data: "Hello Users GET" }); }
export async function POST(request: NextRequest) {
    const body = await request.json();
    const parsed = postSchema.safeParse(body);
     if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
    }
    return NextResponse.json({ data: `Hello Users POST: ${parsed.data.userName}` });
}