import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  // Can be null if Supabase isn't configured (e.g. AUTH_MODE=local or
  // URL missing/invalid). This does NOT crash the boot.
  readonly client: SupabaseClient | null;

  constructor(config: ConfigService) {
    const url = config.get<string>('SUPABASE_URL');
    const anonKey = config.get<string>('SUPABASE_ANON_KEY');

    if (!url || !anonKey) {
      this.logger.warn(
        'SUPABASE_URL/SUPABASE_ANON_KEY missing: Supabase client disabled ' +
          '(expected in local auth mode).',
      );
      this.client = null;
      return;
    }

    try {
      this.client = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    } catch (err) {
      // A malformed URL must not prevent the whole API from starting:
      // only the Supabase auth routes will be unavailable.
      this.logger.error(
        `Unable to initialize the Supabase client, it is disabled: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      this.client = null;
    }
  }
}
