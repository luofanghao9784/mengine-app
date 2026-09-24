export const documentsHref = (tenant: string, document?: string, version?: number) =>
  '#' +
  new URLSearchParams({
    tenant,
    view: 'documents',
    ...(document ? { document } : {}),
    ...(version ? { version: String(version) } : {}),
  });
