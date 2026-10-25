import type { Place } from './data';

/**
 * 场景外壳的地址与企业：
 * - 当前板块写在地址的 hash 里（place=…），刷新回原处，浏览器后退可用，链接可以分享。
 * - 当前企业由外壳传入；数据接口 api() 从这里取，不再读地址栏的 ?tenant=。
 */
const PLACES: Place[] = ['home', 'data', 'knowledge', 'experience', 'members', 'usage', 'company'];
/** 这几个板块里嵌着旧版管理台，它自己在 hash 里记 admin/detail/tab 等参数；离开时一并清掉。 */
const BUSINESS: Place[] = ['members', 'usage', 'company', 'experience'];
const BUSINESS_KEYS = ['admin', 'detail', 'tab', 'member', 'period', 'section'];

export function scenePlace(hash = location.hash): Place | null {
  const p = new URLSearchParams(hash.replace(/^#/, '')).get('place');
  return PLACES.includes(p as Place) ? (p as Place) : null;
}

/** 把当前板块写进地址；replace 为真时不新增历史记录（用于首次打开时补上 place）。 */
export function writeScenePlace(place: Place, replace = false) {
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get('place') === place) return;
  const leaving = params.get('place');
  params.set('place', place);
  if (leaving && !BUSINESS.includes(place)) for (const key of BUSINESS_KEYS) params.delete(key);
  if (replace) history.replaceState(history.state, '', '#' + params);
  else location.hash = params.toString();
}

let tenant: string | null = null;
export const sceneTenant = () => tenant;
export const setSceneTenant = (next: string | null) => {
  tenant = next;
};
