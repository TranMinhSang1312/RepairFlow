import { apiErrorFromResponse } from "./errors";
import type { PublicOrder, QuoteDecisionInput, QuoteDecisionResult } from "./types";

const PUBLIC_TOKEN_HEADER = "X-RepairFlow-Public-Token";
const PUBLIC_BRIDGE_URL = "/api/public";

interface DataResponse<T> {
  data: T;
}

export interface PublicPortalApi {
  getOrder(token: string): Promise<PublicOrder>;
  decideQuote(
    token: string,
    input: QuoteDecisionInput,
    idempotencyKey: string,
  ): Promise<QuoteDecisionResult>;
}

export class BrowserPublicPortalApi implements PublicPortalApi {
  constructor(
    private readonly fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
  ) {}

  async getOrder(token: string): Promise<PublicOrder> {
    const response = await this.request<DataResponse<PublicOrder>>(token, { method: "GET" });
    return response.data;
  }

  async decideQuote(
    token: string,
    input: QuoteDecisionInput,
    idempotencyKey: string,
  ): Promise<QuoteDecisionResult> {
    const response = await this.request<DataResponse<QuoteDecisionResult>>(token, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(input),
    });
    return response.data;
  }

  private async request<T>(token: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set(PUBLIC_TOKEN_HEADER, token);

    const response = await this.fetcher.call(globalThis, PUBLIC_BRIDGE_URL, {
      ...init,
      headers,
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw await apiErrorFromResponse(response);
    return (await response.json()) as T;
  }
}
