import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { Problem } from '../common/problem';

/**
 * Bot protection behind one interface. Cloudflare Turnstile when TURNSTILE_SECRET_KEY is set
 * (free), otherwise a no-op so local development and tests need no keys.
 */
@Injectable()
export class BotCheckService {
  private readonly logger = new Logger(BotCheckService.name);
  constructor(@Inject(ENV) private readonly env: Env) {}

  get enabled(): boolean {
    return !!this.env.TURNSTILE_SECRET_KEY;
  }

  async assertHuman(token: string | undefined, ip: string): Promise<void> {
    if (!this.enabled) return;
    if (!token) throw new Problem('forbidden', 'Bot check required.');
    try {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: this.env.TURNSTILE_SECRET_KEY!,
          response: token,
          remoteip: ip,
        }),
        signal: AbortSignal.timeout(3000),
      });
      const body = (await res.json()) as { success?: boolean };
      if (!body.success) throw new Problem('forbidden', 'Bot check failed.');
    } catch (err) {
      if (err instanceof Problem) throw err;
      this.logger.warn({ msg: 'turnstile unreachable', err });
      throw new Problem('forbidden', 'Bot check unavailable. Try again.');
    }
  }
}
