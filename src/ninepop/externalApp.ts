import type { MiniApp } from '../model.ts';
import { NINEPOP_ADMIN_URL } from './adapter.ts';

export function externalAppUrl(app: MiniApp): string | undefined {
  return app.id === 'ninepop-management' && app.external?.url === NINEPOP_ADMIN_URL
    ? NINEPOP_ADMIN_URL
    : undefined;
}
