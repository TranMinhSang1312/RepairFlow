import { parseWebEnvironment } from "@repairflow/config";

const PUBLIC_TOKEN_HEADER = "x-repairflow-public-token";
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "idempotency-key",
  "user-agent",
] as const;
const FORWARDED_RESPONSE_HEADERS = ["content-type", "retry-after"] as const;

function invalidLinkResponse(): Response {
  return Response.json(
    {
      error: {
        code: "PUBLIC_LINK_INVALID",
        message: "This public link is invalid.",
        requestId: globalThis.crypto.randomUUID(),
      },
    },
    {
      status: 404,
      headers: {
        "Cache-Control": "no-store, private",
        Pragma: "no-cache",
        Vary: "X-RepairFlow-Public-Token",
      },
    },
  );
}

function upstreamUrl(operation: "order" | "decision", token: string): string {
  const environment = parseWebEnvironment(process.env);
  const path =
    operation === "order"
      ? `/public/v1/orders/${encodeURIComponent(token)}`
      : `/public/v1/quotes/${encodeURIComponent(token)}/decision`;
  return new URL(path, environment.NEXT_PUBLIC_API_URL).toString();
}

async function proxy(request: Request, operation: "order" | "decision"): Promise<Response> {
  const token = request.headers.get(PUBLIC_TOKEN_HEADER)?.trim();
  if (!token) return invalidLinkResponse();

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const upstream = await fetch(upstreamUrl(operation, token), {
    method: request.method,
    headers,
    ...(operation === "decision" ? { body: await request.arrayBuffer() } : {}),
    cache: "no-store",
    redirect: "manual",
  });
  const responseHeaders = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("Cache-Control", "no-store, private");
  responseHeaders.set("Pragma", "no-cache");
  responseHeaders.set("Vary", "X-RepairFlow-Public-Token");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const dynamic = "force-dynamic";
export const GET = (request: Request) => proxy(request, "order");
export const POST = (request: Request) => proxy(request, "decision");
