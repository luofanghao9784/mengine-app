import { createContext, useContext, useEffect, useState } from 'react';

/** 手机上左侧导航抽屉里留给当前页面的位置（会话页把会话列表放进来）。 */
export const DrawerSlot = createContext<HTMLElement | null>(null);

const PHONE = '(max-width: 800px)';

/** 手机宽度（800 像素以下）：导航收进抽屉，会话卡片铺满屏幕。 */
export function usePhoneLayout() {
  const [phone, setPhone] = useState(() => matchMedia(PHONE).matches);
  useEffect(() => {
    const query = matchMedia(PHONE);
    const change = () => setPhone(query.matches);
    change();
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return phone;
}

export function useDrawerSlot() {
  return useContext(DrawerSlot);
}
