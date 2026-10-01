import { createContext, useContext, useEffect, useId } from 'react';
export const ExperienceBusyContext = createContext(false);
export const ExperienceGuardContext = createContext<(id: string, locked: boolean) => void>(() => {});
/** A persistent uncertain receipt is independent of a request's temporary busy state. */
export function useExperienceGuard(locked: boolean) {
  const id = useId();
  const guard = useContext(ExperienceGuardContext);
  useEffect(() => {
    guard(id, locked);
    return () => guard(id, false);
  }, [id, locked, guard]);
}
