import { cfg } from "./config.js";

/**
 * CROO public (unauthenticated) metadata endpoints, discovered from the
 * Agent Store frontend. These provide the *promised* side of a certification:
 * listing description, price, SLA, schemas, and self-reported track record.
 */

export interface PublicService {
  serviceId: string;
  agentId: string;
  name: string;
  description: string;
  price: string; // USDC base units (6 decimals)
  slaMinutes: number;
  orders7d: string;
  requirementType: "" | "text" | "schema";
  requirementText: string;
  requirementSchema: string; // JSON string, "[]" when unset
  deliverableType: "text" | "schema";
  deliverableText: string;
  deliverableSchema: string;
  requireFundTransfer?: boolean;
}

export interface PublicAgent {
  agentId: string;
  name: string;
  description: string;
  avatar: string;
  status: string;
  createdTime: string;
  minServicePrice: string;
  completedOrders: string;
  totalEarned: string;
  totalVolume: string;
  completionRate: number;
  avgDeliveryText: string;
  onlineStatus: "online" | "offline" | string;
  skillTagSlugs: string[];
  services: PublicService[];
  /** Agent's AA wallet (present on the public agent endpoint). */
  walletAddress?: string;
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${cfg.apiURL}${path}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function getPublicAgent(agentId: string): Promise<PublicAgent> {
  const d = await getJSON<{ agent: PublicAgent }>(`/backend/v1/public/agents/${agentId}`);
  return d.agent;
}

export async function getPublicService(serviceId: string): Promise<PublicService> {
  const d = await getJSON<{ service: PublicService }>(`/backend/v1/public/services/${serviceId}`);
  return d.service;
}

export async function searchAgents(q: string): Promise<PublicAgent[]> {
  const d = await getJSON<{ agents: PublicAgent[] }>(
    `/backend/v1/public/search?q=${encodeURIComponent(q)}`,
  );
  return d.agents ?? [];
}

export async function listPublicServices(page = 1, pageSize = 50): Promise<PublicService[]> {
  const d = await getJSON<{ items: PublicService[] }>(
    `/backend/v1/public/services?page=${page}&pageSize=${pageSize}`,
  );
  return d.items ?? [];
}

/** Resolve a certification target: accepts a serviceId or an agentId. */
export async function resolveTarget(
  id: string,
): Promise<{ agent: PublicAgent; service: PublicService }> {
  try {
    const service = await getPublicService(id);
    const agent = await getPublicAgent(service.agentId);
    return { agent, service };
  } catch {
    const agent = await getPublicAgent(id);
    if (!agent.services?.length) throw new Error(`Agent ${id} has no services to certify`);
    // Default to the cheapest service within budget, else cheapest overall.
    const sorted = [...agent.services].sort((a, b) => Number(a.price) - Number(b.price));
    return { agent, service: sorted[0] };
  }
}
