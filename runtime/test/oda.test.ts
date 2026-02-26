import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  login,
  searchProducts,
  addToCart,
  getCart,
  getSession,
  clearSession,
  type OdaSession,
} from '../src/lib/oda.js';

// Mock getEnv for getSession tests
vi.mock('../src/lib/env.js', () => ({
  getEnv: () => ({
    ODA_EMAIL: 'test@example.com',
    ODA_PASSWORD: 'secret123',
  }),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const headersObj = new Headers(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headersObj,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  } as unknown as Response;
}

function makeResponseWithCookies(status: number, body: unknown, cookies: string[]): Response {
  const headers = new Headers();
  // getSetCookie is a method on Headers
  const res = {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      ...headers,
      get: (name: string) => headers.get(name),
      getSetCookie: () => cookies,
    },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  } as unknown as Response;
  return res;
}

const testSession: OdaSession = {
  cookies: 'csrftoken=abc123; sessionid=sess456',
  csrfToken: 'abc123',
};

describe('oda client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    clearSession();
  });

  describe('login', () => {
    it('should extract CSRF token and POST JSON credentials to API', async () => {
      // Step 1: GET login page → returns csrftoken cookie
      mockFetch.mockResolvedValueOnce(
        makeResponseWithCookies(200, 'login page html', [
          'csrftoken=tok123; Path=/; Secure',
        ]),
      );

      // Step 2: POST login to JSON API → returns session cookies
      mockFetch.mockResolvedValueOnce(
        makeResponseWithCookies(200, { success: true }, [
          'sessionid=sess789; Path=/; Secure',
          'csrftoken=newtok456; Path=/; Secure',
        ]),
      );

      const session = await login('user@test.com', 'pass123');

      expect(session.csrfToken).toBe('newtok456');
      expect(session.cookies).toContain('sessionid=sess789');
      expect(session.cookies).toContain('csrftoken=newtok456');

      // Verify the login page GET
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [loginPageUrl] = mockFetch.mock.calls[0];
      expect(loginPageUrl).toContain('/no/user/login/');

      // Verify the credentials POST (JSON to API endpoint)
      const [loginUrl, loginOpts] = mockFetch.mock.calls[1];
      expect(loginUrl).toContain('/tienda-web-api/v1/user/login/');
      expect(loginOpts.method).toBe('POST');
      expect(loginOpts.headers['Content-Type']).toBe('application/json');
      expect(loginOpts.headers['X-CSRFToken']).toBe('tok123');
      const body = JSON.parse(loginOpts.body);
      expect(body.username).toBe('user@test.com');
      expect(body.password).toBe('pass123');
    });

    it('should throw if CSRF token is not found', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponseWithCookies(200, 'no cookies', []),
      );

      await expect(login('user@test.com', 'pass')).rejects.toThrow('CSRF token');
    });

    it('should throw on login failure (4xx)', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponseWithCookies(200, '', ['csrftoken=tok; Path=/']),
      );
      mockFetch.mockResolvedValueOnce(
        makeResponseWithCookies(401, { error: 'invalid' }, []),
      );

      await expect(login('user@test.com', 'wrong')).rejects.toThrow('login failed');
    });
  });

  describe('searchProducts', () => {
    it('should parse __NEXT_DATA__ dehydrated query and return products', async () => {
      const nextData = {
        props: {
          pageProps: {
            dehydratedState: {
              queries: [
                {
                  queryKey: ['searchpageresponse', 'gulrot', {}],
                  state: {
                    data: {
                      items: [
                        {
                          type: 'product',
                          attributes: {
                            id: 101,
                            fullName: 'Gulrot 750g',
                            grossPrice: '24.90',
                            unitPriceQuantityAbbreviation: 'pk',
                            availability: { isAvailable: true },
                            images: [{ large: { url: 'https://img.oda.com/gulrot.jpg' } }],
                          },
                        },
                        {
                          type: 'product',
                          attributes: {
                            id: 102,
                            fullName: 'Gulrot baby',
                            grossPrice: '29.90',
                            unitPriceQuantityAbbreviation: 'pk',
                            availability: { isAvailable: false },
                            images: [],
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            },
          },
        },
      };

      const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></body></html>`;
      mockFetch.mockResolvedValueOnce(makeResponse(200, html));

      const results = await searchProducts(testSession, 'gulrot');

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        id: 101,
        name: 'Gulrot 750g',
        price: '24.90',
        unit: 'pk',
        available: true,
        imageUrl: 'https://img.oda.com/gulrot.jpg',
      });
      expect(results[1].available).toBe(false);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/no/search/products/?q=gulrot');
    });

    it('should return empty array when no __NEXT_DATA__ found', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(200, '<html>no data</html>'));

      const results = await searchProducts(testSession, 'xyz');
      expect(results).toEqual([]);
    });

    it('should return empty array on JSON parse failure', async () => {
      const html = '<html><script id="__NEXT_DATA__" type="application/json">invalid json{</script></html>';
      mockFetch.mockResolvedValueOnce(makeResponse(200, html));

      const results = await searchProducts(testSession, 'test');
      expect(results).toEqual([]);
    });
  });

  describe('addToCart', () => {
    it('should POST product with correct body', async () => {
      // getSession → needs login (2 fetches) then addToCart fetch
      mockFetch.mockResolvedValueOnce(
        makeResponseWithCookies(200, '', ['csrftoken=tok; Path=/']),
      );
      mockFetch.mockResolvedValueOnce(
        makeResponseWithCookies(200, { success: true }, ['sessionid=s; Path=/', 'csrftoken=tok; Path=/']),
      );
      mockFetch.mockResolvedValueOnce(makeResponse(201, { ok: true }));

      await addToCart(testSession, 101, 2);

      // The addToCart call is the 3rd fetch (after login page + login post from getSession)
      const [url, opts] = mockFetch.mock.calls[2];
      expect(url).toContain('/tienda-web-api/v1/cart/items/');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.items).toEqual([{ product_id: 101, quantity: 2 }]);
    });

    it('should default quantity to 1', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponseWithCookies(200, '', ['csrftoken=tok; Path=/']),
      );
      mockFetch.mockResolvedValueOnce(
        makeResponseWithCookies(200, {}, ['sessionid=s; Path=/', 'csrftoken=tok; Path=/']),
      );
      mockFetch.mockResolvedValueOnce(makeResponse(201, { ok: true }));

      await addToCart(testSession, 42);

      const body = JSON.parse(mockFetch.mock.calls[2][1].body);
      expect(body.items[0].quantity).toBe(1);
    });
  });

  describe('getCart', () => {
    it('should parse cart response', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponseWithCookies(200, '', ['csrftoken=tok; Path=/']),
      );
      mockFetch.mockResolvedValueOnce(
        makeResponseWithCookies(200, {}, ['sessionid=s; Path=/', 'csrftoken=tok; Path=/']),
      );
      mockFetch.mockResolvedValueOnce(
        makeResponse(200, {
          item_count: 2,
          total_price: '149.80',
          items: [
            { product_id: 101, product: { name: 'Melk' }, quantity: 1, gross_price: '22.90' },
            { product_id: 102, product: { name: 'Brod' }, quantity: 2, gross_price: '39.90' },
          ],
        }),
      );

      const cart = await getCart(testSession);

      expect(cart.itemCount).toBe(2);
      expect(cart.totalPrice).toBe('149.80');
      expect(cart.items).toHaveLength(2);
      expect(cart.items[0]).toEqual({
        productId: 101,
        name: 'Melk',
        quantity: 1,
        price: '22.90',
      });
    });
  });

  describe('session management', () => {
    it('getSession should cache and reuse session', async () => {
      // First call: login
      mockFetch.mockResolvedValueOnce(
        makeResponseWithCookies(200, '', ['csrftoken=tok; Path=/']),
      );
      mockFetch.mockResolvedValueOnce(
        makeResponseWithCookies(200, {}, ['sessionid=s; Path=/', 'csrftoken=tok; Path=/']),
      );

      const session1 = await getSession();
      const session2 = await getSession();

      expect(session1).toBe(session2); // Same reference
      expect(mockFetch).toHaveBeenCalledTimes(2); // Only 1 login
    });

    it('clearSession should force re-login on next getSession', async () => {
      // First login
      mockFetch.mockResolvedValueOnce(
        makeResponseWithCookies(200, '', ['csrftoken=tok1; Path=/']),
      );
      mockFetch.mockResolvedValueOnce(
        makeResponseWithCookies(200, {}, ['sessionid=s1; Path=/', 'csrftoken=tok1; Path=/']),
      );

      await getSession();
      clearSession();

      // Second login
      mockFetch.mockResolvedValueOnce(
        makeResponseWithCookies(200, '', ['csrftoken=tok2; Path=/']),
      );
      mockFetch.mockResolvedValueOnce(
        makeResponseWithCookies(200, {}, ['sessionid=s2; Path=/', 'csrftoken=tok2; Path=/']),
      );

      const session2 = await getSession();
      expect(session2.cookies).toContain('csrftoken=tok2');
      expect(mockFetch).toHaveBeenCalledTimes(4); // 2 logins
    });
  });
});
