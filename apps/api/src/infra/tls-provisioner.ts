import type { Env } from '../config/env';

/**
 * Certificate issuance for verified tenant custom domains, behind one interface.
 *
 * - caddy-on-demand: Caddy issues certificates on the first TLS handshake and asks
 *   GET /v1/internal/tls/ask?domain=... first; that endpoint only says yes for verified
 *   domains. Nothing to push, so allow/revoke are no-ops.
 * - noop: development.
 *
 * A future adapter (e.g. pushing to a load balancer API) implements the same methods.
 */
export abstract class TlsProvisioner {
  abstract readonly name: string;
  abstract allowHost(hostname: string): Promise<void>;
  abstract revokeHost(hostname: string): Promise<void>;
}

class PassiveProvisioner extends TlsProvisioner {
  constructor(readonly name: string) {
    super();
  }
  async allowHost(): Promise<void> {}
  async revokeHost(): Promise<void> {}
}

export function createTlsProvisioner(env: Pick<Env, 'TLS_PROVISIONER'>): TlsProvisioner {
  return new PassiveProvisioner(env.TLS_PROVISIONER);
}
