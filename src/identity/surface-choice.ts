const key = 'dreamcore-choose-surface';
let pending = false;
export function requestSurfaceChoice() {
  pending = true;
  try {
    sessionStorage.setItem(key, 'yes');
  } catch {
    /* In-memory state still shows the choice. */
  }
}
export function pendingSurfaceChoice() {
  try {
    return pending || sessionStorage.getItem(key) === 'yes';
  } catch {
    return pending;
  }
}
export function clearSurfaceChoice() {
  pending = false;
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* No persistent preference is required. */
  }
}
