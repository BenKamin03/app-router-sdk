import { NextResponse } from 'next/server';

export async function GET() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sentence = "This is a streaming response from the Next.js API route.";
      const words = sentence.split(' ');
      
      for (const word of words) {
        controller.enqueue(encoder.encode(word + ' '));
        await new Promise(resolve => setTimeout(resolve, 500)); // Add delay between words
      }
      
      controller.close();
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/plain',
      'Transfer-Encoding': 'chunked',
    },
  });
}
