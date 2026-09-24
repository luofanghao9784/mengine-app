import { isSystemError, isSystemInfo, type SystemInfo } from '../../contracts/public-api/system.ts';

export interface SystemClient {
  getInfo(signal?: AbortSignal): Promise<SystemInfo>;
}

export class SystemClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  constructor(code: string, message: string, status = 0, retryable = false) {
    super(message);
    this.name = 'SystemClientError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

/** Same-origin by default. A transport failure never falls back to the Demo client. */
export function createHttpSystemClient(
  baseUrl = '/api/v1',
  fetcher: typeof fetch = fetch,
  timeoutMs = 3000,
): SystemClient {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new Error('Invalid request timeout');
  }
  return {
    async getInfo(signal) {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      if (signal?.aborted) cancel();
      else signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(cancel, timeoutMs);
      try {
        const response = await fetcher(baseUrl.replace(/\/$/, '') + '/system/info', {
          credentials: 'same-origin',
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
          const errorBody: unknown = await response.json().catch(() => null);
          if (
            isSystemError(errorBody) &&
            ((response.status === 503 && errorBody.code === 'ENGINE_UNAVAILABLE') ||
              (response.status === 502 && errorBody.code === 'ENGINE_INCOMPATIBLE'))
          ) {
            const message =
              errorBody.code === 'ENGINE_UNAVAILABLE'
                ? '引擎暂不可用，请稍后重试。'
                : '引擎契约与平台不兼容。';
            throw new SystemClientError(errorBody.code, message, response.status, errorBody.retryable);
          }
          const message = response.status === 503 ? '引擎暂不可用，请稍后重试。' : '服务请求失败。';
          throw new SystemClientError('HTTP_ERROR', message, response.status, response.status >= 500);
        }
        const payload: unknown = await response.json().catch(() => null);
        if (!isSystemInfo(payload) || payload.dataSource !== 'live') {
          throw new SystemClientError('CONTRACT_MISMATCH', '服务返回的数据不符合当前接口约定。');
        }
        return payload;
      } catch (error) {
        if (controller.signal.aborted) {
          throw new SystemClientError(
            signal?.aborted ? 'CANCELLED' : 'TIMEOUT',
            signal?.aborted ? '请求已取消。' : '请求超时。',
            0,
            !signal?.aborted,
          );
        }
        if (error instanceof SystemClientError) throw error;
        throw new SystemClientError('NETWORK_ERROR', '无法连接服务。', 0, true);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      }
    },
  };
}

/** Explicit development fixture, never selected automatically by the live transport. */
export function createDemoSystemClient(): SystemClient {
  return {
    async getInfo(signal) {
      if (signal?.aborted) throw new SystemClientError('CANCELLED', '请求已取消。');
      return {
        contractVersion: '1.0',
        service: 'dreamcore-platform',
        stage: 'foundation',
        dataSource: 'demo',
        engine: {
          contractVersion: '1.0',
          engineVersion: '0.1.0',
          runtimeMode: 'contract-only',
          capabilities: [],
        },
        integrations: { harness: 'not-configured', weknora: 'not-configured', jev: 'not-configured' },
      };
    },
  };
}
