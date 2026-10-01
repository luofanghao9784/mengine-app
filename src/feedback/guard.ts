import { createContext, useContext, useEffect, useRef } from 'react';
/** Separate persistent request locks from useSubmission's short-lived transport busy flag. */
export const FeedbackLocks = createContext<(key: symbol, locked: boolean) => void>(() => {});
export const FeedbackBusy = createContext(false);
export function useFeedbackGuard(locked: boolean) {
  const register = useContext(FeedbackLocks);
  const key = useRef(Symbol('feedback-request'));
  useEffect(() => {
    if (!locked) return;
    register(key.current, true);
    return () => register(key.current, false);
  }, [locked, register]);
}
