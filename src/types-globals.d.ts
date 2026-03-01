// Minimal Cloudflare Workers global type stubs used for local testing/compilation
interface KVNamespace {
  get(key: string): Promise<string | null> | string | null;
  put?(key: string, value: string): Promise<void> | void;
}

declare var CACHE: KVNamespace;

