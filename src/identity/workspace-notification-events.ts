export const notificationEvent = 'workspace:notifications-changed';
export function invalidateWorkspaceNotifications(tenant: string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(notificationEvent, { detail: tenant }));
}
