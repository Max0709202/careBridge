import { CanActivate, Injectable } from '@nestjs/common';

import { appConfig } from './config';
import { NotFoundError } from './errors';

/**
 * Endpoints that stand in for somebody else's authority: running a trip on the
 * server as though a driver were driving it, a family member reporting a car's
 * position or its delay. Useful on a laptop with no driver app; in production
 * the driver app and the dispatch console exist, and a family account that
 * could move a car on the map would be a way to lie to another family.
 *
 * 404 rather than 403, as everywhere else: production has no such route.
 */
@Injectable()
export class PreviewToolsGuard implements CanActivate {
  canActivate(): boolean {
    if (appConfig().isProduction) throw new NotFoundError();
    return true;
  }
}
