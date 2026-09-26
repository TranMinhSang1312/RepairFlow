import { parseWebEnvironment } from "@repairflow/config";

const TOKEN_HEADER = "x-repairflow-invitation-token";

function invalid(): Response {
  return Response.json(
    {
      error: {
        code: "STAFF_INVITATION_INVALID",
        message: "The staff invitation is unavailable.",
        requestId: globalThis.crypto.randomUUID(),
      },
    },
    {
      status: 404,
      headers: {
        "Cache-Control": "no-store, private",
        "Referrer-Policy": "no-referrer",
        Vary: "X-RepairFlow-Invitation-Token",
      },
    },
  );
}

async function proxy(request: Request): Promise<Response> {
  const token = request.headers.get(TOKEN_HEADER)?.trim();
  if (!token) return invalid();
  const environment = parseWebEnvironment(process.env);
  const upstreamUrl = new URL(
    request.method === "GET" ? "/public/v1/staff-invitation" : "/public/v1/staff-invitation/accept",
    environment.NEXT_PUBLIC_API_URL,
  );
  const headers = new Headers({ Accept: "application/json", [TOKEN_HEADER]: token });
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    ...(request.method === "POST" ? { body: await request.arrayBuffer() } : {}),
    cache: "no-store",
    redirect: "manual",
  });
  const responseHeaders = new Headers({
    "Cache-Control": "no-store, private",
    "Referrer-Policy": "no-referrer",
    Vary: "X-RepairFlow-Invitation-Token",
  });
  for (const name of ["content-type", "retry-after", "set-cookie"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export const dynamic = "force-dynamic";
export const GET = proxy;
export const POST = proxy;
