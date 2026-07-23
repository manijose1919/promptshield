import type { TokenMap } from "../core/types.js";

export interface PromptShieldClientOptions {
  /** Base URL of a running PromptShield server, e.g. http://localhost:8787 */
  baseUrl: string;
  /** PromptShield API key (if the server has auth enabled). */
  apiKey?: string;
  /** Injectable fetch (for tests / non-global-fetch runtimes). */
  fetchImpl?: typeof fetch;
}

export interface RedactResponse {
  redacted: string;
  entities: Array<{
    type: string;
    label: string;
    placeholder: string;
    action: string;
  }>;
  /** Present on the stateless path; omitted when `store_token_map` was set. */
  token_map?: TokenMap;
  /** Present only when `store_token_map` was set (the vault path). */
  token_map_id?: string;
  blocked: boolean;
}

/**
 * Minimal, dependency-free client for the PromptShield HTTP API. Integrators
 * embed this instead of hand-rolling fetch calls; it also documents the wire
 * contract in types.
 */
export class PromptShieldClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: PromptShieldClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) h["authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as T;
    if (!res.ok) {
      throw new PromptShieldError(res.status, data);
    }
    return data;
  }

  /** Redact PII from text. Pass `storeTokenMap` to receive a `token_map_id`. */
  redact(text: string, opts: { storeTokenMap?: boolean } = {}): Promise<RedactResponse> {
    return this.post<RedactResponse>("/v1/redact", {
      text,
      store_token_map: opts.storeTokenMap ?? false,
    });
  }

  /** Rehydrate placeholders using an inline map or a stored map id. */
  rehydrate(
    text: string,
    source: { tokenMap?: TokenMap; tokenMapId?: string },
  ): Promise<{ text: string }> {
    return this.post<{ text: string }>("/v1/rehydrate", {
      text,
      token_map: source.tokenMap,
      token_map_id: source.tokenMapId,
    });
  }
}

export class PromptShieldError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`PromptShield request failed with status ${status}`);
    this.name = "PromptShieldError";
  }
}
