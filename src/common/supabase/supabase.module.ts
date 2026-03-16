import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_CLIENT = 'SUPABASE_CLIENT';

const logger = new Logger('SupabaseModule');

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: SUPABASE_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const supabaseUrl = configService.get<string>('SUPABASE_URL');
        const supabaseServiceRoleKey = configService.get<string>(
          'SUPABASE_SERVICE_ROLE_KEY',
        );
        const supabaseSecretKey = configService.get<string>(
          'SUPABASE_SECRET_KEY',
        );
        const supabaseAnonKey = configService.get<string>('SUPABASE_ANON_KEY');
        const supabaseKey =
          supabaseSecretKey || supabaseServiceRoleKey || supabaseAnonKey;

        if (!supabaseUrl || !supabaseKey) {
          throw new Error(
            'SUPABASE_URL과 SUPABASE_SECRET_KEY(권장) 또는 SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY가 설정되지 않았습니다.',
          );
        }

        if (!supabaseSecretKey && !supabaseServiceRoleKey && supabaseAnonKey) {
          logger.warn(
            'SUPABASE_ANON_KEY를 서버에서 사용 중입니다. 서버 환경에서는 SUPABASE_SECRET_KEY 또는 SUPABASE_SERVICE_ROLE_KEY 사용을 권장합니다.',
          );
        }

        return createClient(supabaseUrl, supabaseKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        });
      },
    },
  ],
  exports: [SUPABASE_CLIENT],
})
export class SupabaseModule {}
