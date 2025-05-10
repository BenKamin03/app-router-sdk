# app-router-sdk

A zero-boilerplate, type-safe API SDK generator for Next.js App Router.  
Automatically generates both client-side and server-side SDKs from your `route.ts` files, giving you end-to-end type inference, built-in React Query hooks, and a consistent, schema-driven API surface.

---

## Table of Contents

- [Design Philosophy](#design-philosophy)  
- [Features](#features)  
- [Getting Started](#getting-started)  
  - [Prerequisites](#prerequisites)  
  - [Installation](#installation)  
  - [Generating the SDK](#generating-the-sdk)  
  - [Watching for Changes](#watching-for-changes)  
- [Usage](#usage)  
  - [Client SDK](#client-sdk)  
  - [Server SDK](#server-sdk)  
- [API Structure](#api-structure)  
- [Configuration & Debugging](#configuration--debugging)  

---

## Design Philosophy

1. **Schema-First & Type-Safe (optional)**  
   Define input/output schemas in your `route.ts` handlers (e.g. using Zod or another schema library) for explicit runtime validation and type inference.  
   If you omit schemas, the SDK will infer types based on your handler implementation and usage.

2. **Zero-Boilerplate**  
   Simply write your App Router `route.ts` files. The generator will:
   - Parse your route tree  
   - Collect imports and schemas  
   - Build a nested `API` object with React Query hooks on the client  
   - Build corresponding server-side functions  

3. **End-to-End Inference**  
   From your Zod schemas to your frontend code, enjoy compile-time type safety: request bodies, query parameters, and responses are all typed.

4. **Watch Mode & Performance**  
   Incremental updates via `--watch` keep your SDK in sync as you edit routes, without ever rebuilding your entire app.

5. **Customizable & Extensible**  
   Edit the code builders in `scripts/api-sdk-utils` to tailor naming conventions, import strategies, or hook patterns.

6. **Avoid Fetching Next API Routes in Server Components**  
   Fetching Next.js API routes directly within server components is generally considered bad practice. This approach can lead to unnecessary complexity and performance issues, as it introduces additional network overhead and can complicate data fetching strategies. Instead, prefer using the generated SDK methods to access data directly, leveraging the type-safe and optimized structure provided by the SDK.

---

## Features

- Automatic discovery of `route.ts` files under `app/`
- Client SDK with ready-to-use React Query `useQuery` and `useMutation` hooks
- Server SDK for direct invocation in other Next.js server contexts
- Full support for:
  - JSON body payloads
  - Query parameters
  - Cookie and header access
  - Redirects, streaming, and no-response endpoints
- Built-in Zod error handling via `tryCatchFunction`
- Prettier-formatted output

---

## Getting Started

### Prerequisites

- Node.js ≥ 18  
- A Next.js App Router project  
- TypeScript  
- (Optional) Zod or other schema library for explicit runtime validation — if omitted, types are inferred from route usage

### Installation

TBD

### Generating the SDK

Run the generator script:

```bash
# one-time generation
npm run generate-sdk
```

This will produce:

- `./api/client-sdk.ts`  
- `./api/server-sdk.ts`

### Watching for Changes

To auto-regenerate on every save:

```bash
npm run generate-sdk -- --watch
```

---

## Usage

### Client SDK

Import your generated client SDK in React components:

```tsx
// app/(dashboard)/page.tsx
'use client';

import { API } from '@/api/client-sdk';

export default function Dashboard() {
  const { data, isLoading, error } = API.USERS.GET();

  if (isLoading) return <p>Loading users…</p>;
  if (error) return <p>Error: {JSON.stringify(error)}</p>;

  return <pre>{JSON.stringify(data, null, 2)}</pre>;
}
```

Perform mutations easily:

```tsx
const createForm = API.FORM.POST();

function onSubmit(values: { name: string; email: string; message: string }) {
  createForm.mutate(values, {
    onSuccess: (response) => console.log('Created!', response.data),
  });
}
```

### Server SDK
  ```tsx
  // app/(dashboard)/page.tsx
  import { API as ServerAPI } from '@/api/server-sdk';

  export default async function DashboardPage() {
    // Fetch users on the server
    const {data, error} = await ServerAPI.USERS.GET();

    return (
      <div>
        <h1>Users</h1>
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </div>
    );
  }
  ```

### Dynamic Routes

#### Client-Side Dynamic Route
```tsx
// app/(posts)/[postId]/page.tsx
'use client';

import { API } from '@/api/client-sdk';

type Props = { params: { postId: string } };

export default function PostPage({ params }: Props) {
  const { data, isLoading, error } = API.POSTS.POSTID(params.postId).GET();

  if (isLoading) return <p>Loading post…</p>;
  if (error) return <p>Error: {JSON.stringify(error)}</p>;

  return (
    <article>
      <h1>Post {params.postId}</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </article>
  );
}
```

#### Server-Side Dynamic Route (React Server Component)
```tsx
// app/(posts)/[postId]/page.tsx
import { API as ServerAPI } from '@/api/server-sdk';

type Props = { params: { postId: string } };

export default async function PostPage({ params }: Props) {
  const { data, error } = await ServerAPI.POSTS.POSTID(params.postId).GET();

  if (error) {
    return <p>Error loading post: {JSON.stringify(error)}</p>;
  }

  return (
    <article>
      <h1>Post {params.postId}</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </article>
  );
}
```

### Catch-All Routes

#### Client-Side Catch-All Route
```tsx
// app/(blog)/[...slug]/page.tsx
'use client';

import { API } from '@/api/client-sdk';

type Props = { params: { slug: string[] } };

export default function BlogPage({ params }: Props) {
  const { data, isLoading, error } = API.BLOG.SLUG(params.slug).GET();

  if (isLoading) return <p>Loading blog…</p>;
  if (error) return <p>Error: {JSON.stringify(error)}</p>;

  return (
    <div>
      <h1>Blog Path: {params.slug.join('/')}</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
```

#### Server-Side Catch-All Route (React Server Component)
```tsx
// app/(blog)/[...slug]/page.tsx
import { API as ServerAPI } from '@/api/server-sdk';

type Props = { params: { slug: string[] } };

export default async function BlogPage({ params }: Props) {
  const { data, error } = await ServerAPI.BLOG.SLUG(params.slug).GET();

  if (error) {
    return <p>Error loading blog: {JSON.stringify(error)}</p>;
  }

  return (
    <div>
      <h1>Blog Path: {params.slug.join('/')}</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
```

---

## API Structure

The generated `API` object mirrors your folder structure under `app/`:

- **Top-Level Route Segments**: Each top-level route segment becomes a property of the `API` object. For example, if you have a route defined as `app/api/form/route.ts`, it will be accessible as `API.FORM`.

- **Dynamic Segments**: Dynamic segments in your routes, such as `[id]`, will be represented as functions. For instance, if you have a route `app/api/posts/[postId]/route.ts`, it will be accessible as `API.POSTS.POSTID(postId)`, where `postId` is a string.

- **Catch-All Segments**: Catch-all segments like `[...slug]` will also be represented as functions. For example, a route defined as `app/api/blog/[...slug]/route.ts` will be accessible as `API.BLOG.SLUG(slug)`, where `slug` is a string array.

- **HTTP Methods**: Each HTTP method (GET, POST, PUT, DELETE, etc.) is mapped to a corresponding method on the API object. For example:
  - `API.USERS.GET()` for fetching users.
  - `API.USERS.POST()` for creating a new user.
  - `API.POSTS.POSTID(postId).GET()` for fetching a specific post by its ID.

- **Nested Routes**: If you have nested routes, they will be represented as nested objects within the `API` object. For example, if you have a route structure like `app/api/admin/settings/route.ts`, it will be accessible as `API.ADMIN.SETTINGS`.

This structure allows for intuitive and type-safe access to your API endpoints, making it easy to work with your Next.js application.

---

## Configuration & Debugging

- **Configuration**: Edit the configuration options in `scripts/api-sdk-utils` to customize the SDK generation process.
- **Debugging**: Use the `--debug` flag with the generator script to get more detailed output and debug information.
- **Hot Reloading**: Use the `--watch` flag with the generator script to have it watch for updates and automatically apply them to the sdks.


