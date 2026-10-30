/**
 * 请求超时信号：有 AbortSignal.any / AbortSignal.timeout 就用原生；
 * 旧浏览器（老 Safari / Chrome）没有时降级为 AbortController + setTimeout，
 * 不抛错，避免调用方卡在加载中。外层 signal 中止时同步中止。
 */
export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  if (typeof AbortSignal.any === 'function' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.any([AbortSignal.timeout(ms), ...(signal ? [signal] : [])]);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const stop = () => {
    clearTimeout(timer);
    controller.abort();
  };
  if (signal?.aborted) stop();
  else signal?.addEventListener('abort', stop, { once: true });
  return controller.signal;
}
