import { useEffect, useState } from 'react';
import type { NativeEvent } from './events.ts';
import type { NativeChatActions, NativeStatus } from './NativeChat';

export type NativeFeed = {
  events: NativeEvent[];
  status?: NativeStatus;
  actions: NativeChatActions;
  /** Synthetic development data; the page labels it so it is never mistaken for a real session. */
  preview: boolean;
};

/**
 * The live feed arrives with the platform's event relay (B1, see the alignment checklist). Until then
 * there is no feed and the page keeps its current layout. In local development only, `nativePreview=1`
 * in the address loads synthetic events so the conversation view can be reviewed; production builds
 * drop that branch entirely.
 */
export function useNativeFeed(tenant: string, id: string): NativeFeed | null {
  const [feed, setFeed] = useState<NativeFeed | null>(null);
  // Read on every render: the page re-renders on each address change, so removing the flag ends the preview.
  const preview =
    import.meta.env.DEV && id !== 'new' && new URLSearchParams(location.hash.slice(1)).has('nativePreview');
  useEffect(() => {
    setFeed(null);
    if (!preview) return;
    let active = true;
    void import('./preview.ts').then(({ previewFeed }) => {
      if (active) previewFeed(setFeed);
    });
    return () => {
      active = false;
    };
  }, [tenant, id, preview]);
  return feed;
}
