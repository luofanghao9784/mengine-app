import { PublicReader, loopbackProxyRequest, publicAddress, publicUrl, type PinnedRequest } from './public-web.js';
import { RuntimeError } from './ports.js';
import { isRecord } from './http-json.js';
/** Optional public DNS resolution has its own bounded, TLS-verified bootstrap route. No private names may enter it. */
export function publicDnsResolver(bootstrap: PublicReader) {
  return async (host: string, signal = AbortSignal.timeout(7000)) => {
    publicUrl('https://' + host + '/');
    const endpoint = new URL('https://dns.google/resolve');
    endpoint.search = new URLSearchParams({
      name: host,
      type: 'A',
      edns_client_subnet: '0.0.0.0/0',
    }).toString();
    const { response } = await bootstrap.fetch(endpoint.href, signal, false);
    if (!response.headers['content-type']?.includes('application/json') || response.bytes.length > 32768)
      throw new RuntimeError('PUBLIC_DNS_FAILED');
    let data: unknown;
    try {
      data = JSON.parse(response.bytes.toString('utf8'));
    } catch {
      throw new RuntimeError('PUBLIC_DNS_FAILED');
    }
    if (
      !isRecord(data) ||
      data.Status !== 0 ||
      data.TC === true ||
      !Array.isArray(data.Question) ||
      !isRecord(data.Question[0]) ||
      String(data.Question[0].name).replace(/\.$/, '').toLowerCase() !== host.toLowerCase() ||
      !Array.isArray(data.Answer) ||
      data.Answer.length > 32
    )
      throw new RuntimeError('PUBLIC_DNS_FAILED');
    const records = data.Answer.filter((x) => isRecord(x) && x.type === 1);
    if (
      !records.length ||
      records.some((x) => !isRecord(x) || typeof x.data !== 'string' || !publicAddress(x.data))
    )
      throw new RuntimeError('PUBLIC_ADDRESS_DENIED');
    return records.map((x) => ({ address: (x as { data: string }).data, family: 4 }));
  };
}
/** Google DoH must bootstrap without consulting the DNS route it replaces.
 * Keep TLS/SNI on dns.google; only its documented public resolver IP is pinned.
 */
export function publicDnsBootstrap(transport?: PinnedRequest) {
  return new PublicReader(async (host) => {
    if (host !== 'dns.google') throw new RuntimeError('PUBLIC_DNS_FAILED');
    return [{ address: '8.8.8.8', family: 4 }];
  }, transport);
}

export function configuredPublicReader(proxy?: string, dns = 'system') {
  if (!['system', 'google'].includes(dns)) throw new RuntimeError('INVALID_PUBLIC_DNS');
  const transport = proxy ? loopbackProxyRequest(proxy) : undefined;
  return dns === 'google'
    ? new PublicReader(publicDnsResolver(publicDnsBootstrap(transport)), transport)
    : new PublicReader(undefined, transport);
}
