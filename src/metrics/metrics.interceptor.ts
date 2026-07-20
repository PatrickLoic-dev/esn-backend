import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

// Enregistre durée + statut de chaque requête HTTP dans MetricsService.
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const start = Date.now();
    const http = context.switchToHttp();
    const req = http.getRequest<{ method: string; route?: { path?: string }; url: string }>();
    const record = (status: number) => {
      const route = req.route?.path ?? req.url.split('?')[0];
      this.metrics.record(`${req.method} ${route}`, status, Date.now() - start);
    };
    return next.handle().pipe(
      tap({
        next: () => record(http.getResponse<{ statusCode: number }>().statusCode),
        error: (err: { status?: number }) => record(err?.status ?? 500),
      }),
    );
  }
}
