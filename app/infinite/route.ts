// app/api/posts/route.ts
import { NextRequest, NextResponse } from 'next/server';

// Simulated data source
const ALL_POSTS = Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    title: `Post ${i + 1}`,
}));

const PAGE_SIZE = 10;

export async function GET(req: NextRequest) {
    'use infinite';

    const { searchParams } = req.nextUrl;
    const page = parseInt(searchParams.get('pagination') || '1', 10);

    const start = (page - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const items = ALL_POSTS.slice(start, end);

    const hasNextPage = end < ALL_POSTS.length;
    const nextPage = hasNextPage ? page + 1 : null;

    return NextResponse.json({
        items,
        nextPage,
    });
}

export async function POST(req: NextRequest) {
    'use infinite';

    const { searchParams } = req.nextUrl;
    const page = parseInt(searchParams.get('pagination') || '1', 10);
	const body = await req.json();

    const start = (page - 1) * body.pageSize;
    const end = start + body.pageSize;
    const items = ALL_POSTS.slice(start, end);

    const hasNextPage = end < ALL_POSTS.length;
    const nextPage = hasNextPage ? page + 1 : null;

    return NextResponse.json({
        items,
        nextPage,
    });
}
