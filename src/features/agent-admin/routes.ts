export function agentRoute(hash: string) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const view = params.get('view') === 'capability-registry' ? 'capability-registry' : 'functions';
  const tab = params.get('tab');
  return { view, tab: tab === 'versions' || tab === 'grants' ? tab : 'catalog' } as const;
}
