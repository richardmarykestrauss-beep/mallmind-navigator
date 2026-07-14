/**
 * Adapter Registry.
 *
 * Registers typed adapters, prevents duplicate ids, exposes capabilities/status,
 * and supports enable/disable. There is NO dynamic code execution and NO remote
 * code loading — adapters are plain objects registered in-process.
 */

import type { AdapterCapabilities, AdapterRegistration, AdapterStatus, SourceAdapter } from "./types";

export class DuplicateAdapterError extends Error {
  constructor(public adapterId: string) {
    super(`Adapter "${adapterId}" is already registered.`);
    this.name = "DuplicateAdapterError";
  }
}

export interface RegisterOptions {
  name: string;
  status: AdapterStatus;
  capabilities: AdapterCapabilities;
  description: string;
  enabled?: boolean;
}

export class AdapterRegistry {
  private map = new Map<string, AdapterRegistration>();

  register(adapter: SourceAdapter, opts: RegisterOptions): AdapterRegistration {
    if (this.map.has(adapter.adapterId)) throw new DuplicateAdapterError(adapter.adapterId);
    const reg: AdapterRegistration = {
      adapter,
      name: opts.name,
      status: opts.status,
      enabled: opts.enabled ?? opts.status !== "disabled",
      capabilities: opts.capabilities,
      description: opts.description,
      lastRunAt: null,
      lastRunId: null,
    };
    this.map.set(adapter.adapterId, reg);
    return reg;
  }

  has(adapterId: string): boolean {
    return this.map.has(adapterId);
  }

  get(adapterId: string): AdapterRegistration | undefined {
    return this.map.get(adapterId);
  }

  /** Throws if unknown or disabled — used before execution. */
  require(adapterId: string): AdapterRegistration {
    const reg = this.map.get(adapterId);
    if (!reg) throw new Error(`Unknown adapter "${adapterId}".`);
    if (!reg.enabled || reg.status === "disabled") throw new Error(`Adapter "${adapterId}" is disabled and cannot run.`);
    return reg;
  }

  list(): AdapterRegistration[] {
    return [...this.map.values()];
  }

  setEnabled(adapterId: string, enabled: boolean): void {
    const reg = this.map.get(adapterId);
    if (!reg) throw new Error(`Unknown adapter "${adapterId}".`);
    reg.enabled = enabled;
    if (!enabled) reg.status = "disabled";
  }

  setStatus(adapterId: string, status: AdapterStatus): void {
    const reg = this.map.get(adapterId);
    if (!reg) throw new Error(`Unknown adapter "${adapterId}".`);
    reg.status = status;
    reg.enabled = status !== "disabled";
  }

  capabilities(adapterId: string): AdapterCapabilities | undefined {
    return this.map.get(adapterId)?.capabilities;
  }

  recordRun(adapterId: string, runId: string, at: string): void {
    const reg = this.map.get(adapterId);
    if (reg) { reg.lastRunAt = at; reg.lastRunId = runId; }
  }
}

/** Sensible default capabilities for the deterministic prototype adapters. */
export function defaultCapabilities(over: Partial<AdapterCapabilities> = {}): AdapterCapabilities {
  return {
    supportsDiscovery: true,
    supportsCapture: true,
    supportsExtraction: true,
    supportsValidation: true,
    requiresAuthorization: false,
    automatedAccessAllowed: false,
    humanReviewRequired: true,
    supportsScheduling: false,
    supportsWebhooks: false,
    ...over,
  };
}
