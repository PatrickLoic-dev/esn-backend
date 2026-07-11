import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  // Peut être null si Supabase n'est pas configuré (ex. AUTH_MODE=local ou
  // URL absente/invalide). On NE fait pas planter le boot pour autant.
  readonly client: SupabaseClient | null;

  constructor(config: ConfigService) {
    const url = config.get<string>('SUPABASE_URL');
    const anonKey = config.get<string>('SUPABASE_ANON_KEY');

    if (!url || !anonKey) {
      this.logger.warn(
        'SUPABASE_URL/SUPABASE_ANON_KEY absents : client Supabase désactivé ' +
          "(normal en mode d'authentification locale).",
      );
      this.client = null;
      return;
    }

    try {
      this.client = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    } catch (err) {
      // Une URL mal formée ne doit pas empêcher toute l'API de démarrer :
      // seules les routes d'auth Supabase seront indisponibles.
      this.logger.error(
        `Initialisation du client Supabase impossible, il est désactivé : ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      this.client = null;
    }
  }
}
