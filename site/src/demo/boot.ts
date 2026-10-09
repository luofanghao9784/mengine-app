// 先装上合成接口，再启动主仓库里真实的客户端。这一页不连接任何后台。
import { installMockApi } from './mock-api';
import { isolateDemoBrowserState } from './isolation';

isolateDemoBrowserState();
installMockApi();
if (!location.hash) location.hash = `tenant=${'00000000-0000-4000-8000-000000000001'}&view=briefing`;
await import('@dreamcore/src/identity/main.tsx');
