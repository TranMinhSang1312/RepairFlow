import { parseWebEnvironment } from "@repairflow/config";

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "authorization",
  "content-type",
  "cookie",
  "idempotency-key",
  "x-shop-id",
] as const;

const FORWARDED_RESPONSE_HEADERS = ["content-type", "retry-after", "set-cookie"] as const;

async function proxy(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  const environment = parseWebEnvironment(process.env);
  const upstreamBase = environment.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
  const incomingUrl = new URL(request.url);
  const upstreamUrl = `${upstreamBase}/${path.map(encodeURIComponent).join("/")}${incomingUrl.search}`;
  const headers = new Headers();

  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    ...(hasBody ? { body: await request.arrayBuffer() } : {}),
    cache: "no-store",
    redirect: "manual",
  });
  const responseHeaders = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export const dynamic = "force-dynamic";
export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
