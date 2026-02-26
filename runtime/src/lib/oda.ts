import { getEnv } from './env.js';

const BASE_URL = 'https://oda.com';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface OdaSession {
  cookies: string;
  csrfToken: string;
}

export interface OdaProduct {
  id: number;
  name: string;
  price: string;
  unit: string;
  available: boolean;
  imageUrl?: string;
}

export interface OdaCartItem {
  productId: number;
  name: string;
  quantity: number;
  price: string;
}

export interface OdaCart {
  itemCount: number;
  totalPrice: string;
  items: OdaCartItem[];
}

let cachedSession: OdaSession | null = null;

/** Extract all Set-Cookie values from a Response and merge into a single cookie string */
function extractCookies(res: Response, existingCookies = ''): string {
  const cookieMap = new Map<string, string>();

  // Parse existing cookies
  for (const pair of existingCookies.split('; ').filter(Boolean)) {
    const [k, ...v] = pair.split('=');
    cookieMap.set(k, v.join('='));
  }

  // Parse new Set-Cookie headers
  const setCookies = res.headers.getSetCookie?.() ?? [];
  for (const sc of setCookies) {
    const parts = sc.split(';')[0];
    const [k, ...v] = parts.split('=');
    cookieMap.set(k.trim(), v.join('='));
  }

  return Array.from(cookieMap.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/** Extract CSRF token from cookies string */
function extractCsrfToken(cookies: string): string | null {
  const match = cookies.match(/csrftoken=([^;]+)/);
  return match ? match[1] : null;
}

/** Check if a response indicates the session has expired */
function isSessionExpired(res: Response): boolean {
  if (res.status === 401 || res.status === 403) return true;
  // Redirect to login page
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location') ?? '';
    if (location.includes('/login') || location.includes('/user/login')) return true;
  }
  return false;
}

/** Log in to Oda.com and return a session with cookies + CSRF token */
export async function login(email: string, password: string): Promise<OdaSession> {
  // Step 1: GET login page to obtain CSRF cookie
  const loginPageRes = await fetch(`${BASE_URL}/no/user/login/`, {
    method: 'GET',
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'manual',
  });

  let cookies = extractCookies(loginPageRes);
  const csrfToken = extractCsrfToken(cookies);
  if (!csrfToken) {
    throw new Error('Failed to extract CSRF token from Oda login page');
  }

  // Step 2: POST credentials
  const loginRes = await fetch(`${BASE_URL}/tienda-web-api/v1/user/login/`, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
      'X-CSRFToken': csrfToken,
      'Cookie': cookies,
      'Referer': `${BASE_URL}/no/user/login/`,
    },
    body: JSON.stringify({ email, password }),
    redirect: 'manual',
  });

  if (loginRes.status >= 400) {
    throw new Error(`Oda login failed with status ${loginRes.status}`);
  }

  cookies = extractCookies(loginRes, cookies);
  const sessionCsrf = extractCsrfToken(cookies) ?? csrfToken;

  return { cookies, csrfToken: sessionCsrf };
}

/** Get a valid session — returns cached or logs in fresh */
export async function getSession(): Promise<OdaSession> {
  if (cachedSession) return cachedSession;

  const env = getEnv();
  if (!env.ODA_EMAIL || !env.ODA_PASSWORD) {
    throw new Error('ODA_EMAIL and ODA_PASSWORD must be set');
  }

  cachedSession = await login(env.ODA_EMAIL, env.ODA_PASSWORD);
  return cachedSession;
}

/** Clear cached session (used on auth failure before retry) */
export function clearSession(): void {
  cachedSession = null;
}

/** Internal: make authenticated request with auto-retry on session expiry */
async function authedFetch(url: string, init: RequestInit, retry = true): Promise<Response> {
  const session = await getSession();

  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    'Cookie': session.cookies,
    ...(init.headers as Record<string, string> ?? {}),
  };

  // Add CSRF token for mutating requests
  if (init.method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(init.method)) {
    headers['X-CSRFToken'] = session.csrfToken;
    headers['Referer'] = BASE_URL;
  }

  const res = await fetch(url, { ...init, headers, redirect: 'manual' });

  if (isSessionExpired(res) && retry) {
    clearSession();
    return authedFetch(url, init, false);
  }

  return res;
}

/** Search for products on Oda.com */
export async function searchProducts(session: OdaSession, query: string): Promise<OdaProduct[]> {
  const url = `${BASE_URL}/no/search/products/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': USER_AGENT,
      'Cookie': session.cookies,
    },
    redirect: 'manual',
  });

  if (isSessionExpired(res)) {
    throw new Error('Session expired during product search');
  }

  const html = await res.text();

  // Extract __NEXT_DATA__ JSON from the HTML
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (!match) return [];

  try {
    const nextData = JSON.parse(match[1]);
    const items = nextData?.props?.pageProps?.products
      ?? nextData?.props?.pageProps?.initialData?.products
      ?? [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return items.map((item: any) => ({
      id: item.id as number,
      name: (item.name ?? item.full_name ?? '') as string,
      price: String(item.gross_price ?? item.price ?? ''),
      unit: (item.unit_price_quantity_abbreviation ?? item.unit ?? '') as string,
      available: item.availability?.is_available !== false,
      imageUrl: (item.images?.[0]?.large?.url ?? undefined) as string | undefined,
    }));
  } catch {
    return [];
  }
}

/** Add a product to the Oda cart */
export async function addToCart(_session: OdaSession, productId: number, quantity = 1): Promise<void> {
  const res = await authedFetch(`${BASE_URL}/tienda-web-api/v1/cart/items/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ product_id: productId, quantity }] }),
  });

  if (!res.ok && res.status !== 201) {
    throw new Error(`Oda addToCart failed: ${res.status}`);
  }
}

/** Get the current Oda cart */
export async function getCart(_session: OdaSession): Promise<OdaCart> {
  const res = await authedFetch(`${BASE_URL}/tienda-web-api/v1/cart/`, {
    method: 'GET',
  });

  if (!res.ok) {
    throw new Error(`Oda getCart failed: ${res.status}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as any;
  const items = (data.items ?? []) as any[];

  return {
    itemCount: (data.item_count ?? items.length) as number,
    totalPrice: String(data.total_price ?? data.gross_amount ?? '0'),
    items: items.map((item) => ({
      productId: (item.product_id ?? item.product?.id ?? 0) as number,
      name: (item.product?.name ?? item.name ?? '') as string,
      quantity: (item.quantity ?? 1) as number,
      price: String(item.gross_price ?? item.price ?? ''),
    })),
  };
}
