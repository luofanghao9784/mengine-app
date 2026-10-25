/** First-release defaults; local builds may expose implemented entries for acceptance. */
const localEntries = import.meta.env?.VITE_LOCAL_FEATURE_ENTRIES === 'true';
// Entry visibility never grants access or starts/stops background work.
export const featureEntries = {
  attention: localEntries,
  ongoingPlans: localEntries,
  forwarding: localEntries,
};
