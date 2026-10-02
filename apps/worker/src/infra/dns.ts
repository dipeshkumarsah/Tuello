import { Resolver } from 'node:dns/promises';

/** DNS lookups used by custom-domain verification, behind an interface so tests can fake them. */
export abstract class DnsResolver {
  abstract resolveTxt(name: string): Promise<string[][]>;
  abstract resolveCname(name: string): Promise<string[]>;
}

export class SystemDnsResolver extends DnsResolver {
  private readonly resolver = new Resolver({ timeout: 3000, tries: 2 });
  constructor(servers?: string[]) {
    super();
    if (servers?.length) this.resolver.setServers(servers);
  }
  resolveTxt(name: string) {
    return this.resolver.resolveTxt(name);
  }
  resolveCname(name: string) {
    return this.resolver.resolveCname(name);
  }
}
