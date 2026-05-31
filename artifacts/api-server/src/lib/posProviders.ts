import type { posIntegrationsTable } from "@workspace/db";
import type { InferSelectModel } from "drizzle-orm";

export type PosIntegration = InferSelectModel<typeof posIntegrationsTable>;

export const POS_DATA_TYPES = ["sales", "bills", "customers", "vendors", "purchases", "menu_items"] as const;
export type PosDataType = typeof POS_DATA_TYPES[number];

export const POS_DATA_TYPE_LABELS: Record<PosDataType, string> = {
  sales: "Sales / Orders",
  bills: "Bills (with invoice number)",
  customers: "Customers",
  vendors: "Vendors",
  purchases: "Purchase Bills",
  menu_items: "Menu Items",
};

export type CapabilityStatus = "supported" | "not_supported" | "webhook_only";

export interface ProviderCapability {
  status: CapabilityStatus;
  hint?: string;
}

export type CapabilityMatrix = Record<PosDataType, ProviderCapability>;

export interface FetchOptions {
  from?: string;
  to?: string;
}

export interface FetchResult {
  records: any[];
  errors: string[];
  apiUrl?: string;
}

type FetchHandler = (integration: PosIntegration, opts: { from: string; to: string }) => Promise<FetchResult>;

interface ProviderEntry {
  status: CapabilityStatus;
  hint?: string;
  handler?: FetchHandler;
}

type ProviderRegistry = Record<PosDataType, ProviderEntry>;

// Single source of truth: each provider's per-data-type capability AND its fetch handler
// live together. A "supported" entry MUST have a handler; we enforce this at startup.
const PROVIDER_REGISTRY: Record<string, ProviderRegistry> = {
  petpooja: {
    sales: { status: "supported", hint: "Pulled from Petpooja Order History API for the selected date range. Webhook also auto-pushes new orders.", handler: (i, o) => fetchPetpoojaOrders(i, o.from, o.to) },
    bills: { status: "supported", hint: "Bills/invoices are returned together with sales orders (each order has a customer_invoice_id).", handler: (i, o) => fetchPetpoojaOrders(i, o.from, o.to) },
    customers: { status: "supported", hint: "Customer info is extracted from each fetched order. A dedicated customer-list API is not exposed by Petpooja.", handler: (i, o) => fetchPetpoojaOrders(i, o.from, o.to) },
    vendors: { status: "not_supported", hint: "Petpooja does not expose vendor master data via its public API. Use a vendor/supply-chain POS like Marg or Tally for this." },
    purchases: { status: "not_supported", hint: "Petpooja does not expose purchase / inward bills via its public API." },
    menu_items: { status: "webhook_only", hint: "Menu items are auto-created in this app when an order arrives. A pull-side menu API is not enabled in this build." },
  },
};

const GENERIC_ENTRY: ProviderEntry = { status: "not_supported", hint: "Live pull is not configured for this provider yet." };
const GENERIC_REGISTRY: ProviderRegistry = POS_DATA_TYPES.reduce((acc, k) => { acc[k] = GENERIC_ENTRY; return acc; }, {} as ProviderRegistry);

function getRegistry(provider: string): ProviderRegistry {
  return PROVIDER_REGISTRY[provider] || GENERIC_REGISTRY;
}

export function getProviderCapabilities(provider: string): CapabilityMatrix {
  const reg = getRegistry(provider);
  return POS_DATA_TYPES.reduce((acc, k) => {
    const entry = reg[k];
    acc[k] = { status: entry.status, hint: entry.hint };
    return acc;
  }, {} as CapabilityMatrix);
}

// Startup invariant: any "supported" entry must have a handler. Catches drift bugs.
for (const [provider, reg] of Object.entries(PROVIDER_REGISTRY)) {
  for (const k of POS_DATA_TYPES) {
    const entry = reg[k];
    if (entry.status === "supported" && !entry.handler) {
      throw new Error(`Provider ${provider}: data type "${k}" is marked supported but has no handler`);
    }
  }
}

export class PosFetchError extends Error {
  public code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "PosFetchError";
  }
}

const FETCH_TIMEOUT_MS = 15000;

async function httpJson(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!res.ok) {
      throw new PosFetchError(
        res.status === 401 || res.status === 403 ? "auth" : "http",
        `POS API responded ${res.status}: ${typeof body === "string" ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200)}`,
      );
    }
    return body;
  } catch (e: any) {
    if (e instanceof PosFetchError) throw e;
    if (e.name === "AbortError") throw new PosFetchError("timeout", `POS API timed out after ${(init.timeoutMs ?? FETCH_TIMEOUT_MS) / 1000}s`);
    throw new PosFetchError("network", `POS API unreachable: ${e.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

// SSRF guard: only allow https:// to known POS host suffixes. Blocks internal hostnames,
// private IPs, link-local metadata, file:// schemes, etc. New providers must extend this list.
export const PETPOOJA_ALLOWED_HOST_SUFFIXES = [
  "petpooja.com",
  "petpooja.in",
];

export function assertSafeProviderUrl(rawUrl: string, allowedSuffixes: string[]): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new PosFetchError("config", `Invalid POS base URL: ${rawUrl}`);
  }
  if (parsed.protocol !== "https:") {
    throw new PosFetchError("config", `POS base URL must use https:// (got ${parsed.protocol})`);
  }
  const host = parsed.hostname.toLowerCase();
  // Reject IP literals outright — provider hosts must be DNS names.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) {
    throw new PosFetchError("config", `POS base URL must use a provider hostname, not an IP address`);
  }
  const ok = allowedSuffixes.some(s => host === s || host.endsWith("." + s));
  if (!ok) {
    throw new PosFetchError(
      "config",
      `POS base URL host "${host}" is not in the allow-list. Allowed suffixes: ${allowedSuffixes.join(", ")}`,
    );
  }
  return parsed;
}

async function fetchPetpoojaOrders(integration: PosIntegration, from: string, to: string): Promise<FetchResult> {
  if (!integration.accessToken) {
    throw new PosFetchError("config", "Access token is not configured for this Petpooja integration. Set the access token in integration settings before using manual fetch.");
  }
  if (!integration.restaurantId) {
    throw new PosFetchError("config", "Restaurant ID is not configured for this Petpooja integration.");
  }
  const rawBase = (integration.baseUrl || "https://api.petpooja.com").replace(/\/+$/, "");
  // SSRF protection: validate base URL points at a real Petpooja host before making the request.
  assertSafeProviderUrl(rawBase, PETPOOJA_ALLOWED_HOST_SUFFIXES);
  const url = `${rawBase}/orders/orderHistory`;
  const payload = {
    restID: integration.restaurantId,
    app_key: integration.apiKey || undefined,
    app_secret: integration.apiSecret || undefined,
    access_token: integration.accessToken,
    from_date: from,
    to_date: to,
  };
  const body = await httpJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(payload),
  });
  const orders: any[] = Array.isArray(body?.orders) ? body.orders
    : Array.isArray(body?.data) ? body.data
    : Array.isArray(body) ? body
    : [];
  return { records: orders, errors: [], apiUrl: url };
}

export async function fetchFromPos(
  integration: PosIntegration,
  dataType: PosDataType,
  opts: FetchOptions,
): Promise<FetchResult> {
  const reg = getRegistry(integration.provider);
  const entry = reg[dataType];
  if (entry.status !== "supported") {
    throw new PosFetchError(
      entry.status === "webhook_only" ? "webhook_only" : "unsupported",
      entry.hint || `${dataType} is not available for live pull from ${integration.provider}.`,
    );
  }
  if (!opts.from || !opts.to) {
    throw new PosFetchError("config", "Date range (from, to) is required for live POS fetch.");
  }
  if (!entry.handler) {
    throw new PosFetchError("unsupported", `Provider "${integration.provider}" does not yet implement live fetch for ${dataType}.`);
  }
  return entry.handler(integration, { from: opts.from, to: opts.to });
}
