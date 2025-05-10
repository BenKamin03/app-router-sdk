import { NextResponse } from 'next/server';

import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
	'use mutation';
	
	const body = await request.json();
	console.log(body);
	return NextResponse.json({ message: 'Hello, world!' });
}
