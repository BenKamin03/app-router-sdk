import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const putSchema = z.object({ content: z.string() });

export async function GET(request: NextRequest, { params }: { params: Promise<{ postId: string }> }) { return NextResponse.json({ data: `Hello Post GET: ${(await params).postId}` }); }
export async function PUT(request: NextRequest, { params }: { params: Promise<{ postId: string }> }) {
    const body = await request.json();
    const parsed = putSchema.safeParse(body);
     if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
    }
    return NextResponse.json({ data: `Hello Post PUT: ${(await params).postId}, Body: ${parsed.data.content}` });
}
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ postId: string }> }) { return NextResponse.json({ data: `Hello Post DELETE: ${(await params).postId}` }); }