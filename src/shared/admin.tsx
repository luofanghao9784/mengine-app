import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type DependencyList,
  type ReactNode,
} from 'react';
import { ChevronLeft, ChevronRight, WifiOff, ShieldX } from 'lucide-react';
import { IdentityError } from '../identity/client';
import { useSession } from '../identity/session';
import { Button, Empty } from './ui';
export const MutationGate = createContext<(busy: boolean) => void>(() => {});
const errorMessage = (error: unknown) =>
  error instanceof IdentityError ? error.message : '请求未完成，请稍后重试。';
export function useRemote<T>(load: (signal: AbortSignal) => Promise<T>, dependencies: DependencyList) {
  const { expire } = useSession();
  const [state, setState] = useState<{ value?: T; error?: unknown }>({});
  useEffect(() => {
    const controller = new AbortController();
    setState({});
    load(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setState({ value });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof IdentityError && error.status === 401) expire();
        else setState({ error });
      });
    return () => controller.abort();
  }, [...dependencies, expire]);
  return state;
}
export function Failure({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <Empty
      icon={error instanceof IdentityError && error.status === 403 ? ShieldX : WifiOff}
      title={error instanceof IdentityError && error.status === 403 ? '没有访问权限' : '暂时无法读取'}
      text={errorMessage(error)}
    >
      <Button onClick={retry}>重试</Button>
    </Empty>
  );
}
export function Loading() {
  return (
    <p className="platform-loading" role="status">
      正在读取…
    </p>
  );
}
export function Pager({
  page,
  next,
  onPage,
}: {
  page: number;
  next: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <div className="platform-pagination">
      <Button aria-label="上一页" icon={ChevronLeft} disabled={!page} onClick={() => onPage(page - 1)}>
        上一页
      </Button>
      <span>第 {page + 1} 页</span>
      <Button aria-label="下一页" icon={ChevronRight} disabled={!next} onClick={() => onPage(page + 1)}>
        下一页
      </Button>
    </div>
  );
}

// Retain the same key and submitted payload after uncertain transport failure. No automatic replay.
export function useSubmission<T>() {
  const gate = useContext(MutationGate);
  const { expire } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<{ key: string; fingerprint: string; body: T } | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return {
    busy,
    error,
    uncertain,
    async submit(body: T, execute: (body: T, requestId: string) => Promise<void>) {
      if (busy) return;
      const fingerprint = JSON.stringify(body);
      if (!pending.current || (!uncertain && pending.current.fingerprint !== fingerprint))
        pending.current = { key: crypto.randomUUID(), fingerprint, body };
      const submission = pending.current;
      setBusy(true);
      gate(true);
      setError(undefined);
      try {
        await execute(submission.body, submission.key);
      } catch (e) {
        if (e instanceof IdentityError && e.status === 401) expire();
        if (mounted.current) {
          setError(e);
          setUncertain(
            e instanceof IdentityError &&
              (['UNCERTAIN_RESULT', 'CONTRACT_MISMATCH'].includes(e.code) ||
                (e.status >= 500 && e.code !== 'INVITATION_DELIVERY_UNAVAILABLE')),
          );
        }
      } finally {
        gate(false);
        if (mounted.current) setBusy(false);
      }
    },
  };
}
export function SubmitError({ error, uncertain }: { error: unknown; uncertain: boolean }) {
  return error ? (
    <p className="access-alert" role="alert">
      {errorMessage(error)}
      {uncertain && ' 请保持原内容重试，系统会核对同一次请求。'}
    </p>
  ) : null;
}
export function FormActions({ children }: { children: ReactNode }) {
  return <div className="platform-form-actions">{children}</div>;
}
