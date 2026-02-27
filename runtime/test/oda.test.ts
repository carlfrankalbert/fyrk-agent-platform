import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  login,
  searchProducts,
  addToCart,
  getCart,
  getSession,
  clearSession,
  extractWeightGrams,
  bestMatch,
  extractPackCount,
  type OdaSession,
  type OdaProduct,
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

    it('should combine fullName + nameExtra in product name', async () => {
      const nextData = {
        props: {
          pageProps: {
            dehydratedState: {
              queries: [
                {
                  queryKey: ['searchpageresponse', 'kylling', {}],
                  state: {
                    data: {
                      items: [
                        {
                          type: 'product',
                          attributes: {
                            id: 201,
                            fullName: 'Kyllingfilet',
                            nameExtra: 'ca. 700g',
                            grossPrice: '89.90',
                            unitPriceQuantityAbbreviation: 'pk',
                            availability: { isAvailable: true },
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

      const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></html>`;
      mockFetch.mockResolvedValueOnce(makeResponse(200, html));

      const results = await searchProducts(testSession, 'kylling');
      expect(results[0].name).toBe('Kyllingfilet ca. 700g');
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

      await addToCart(101, 2);

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

      await addToCart(42);

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

      const cart = await getCart();

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

  describe('extractWeightGrams', () => {
    it('should parse kilograms to grams', () => {
      expect(extractWeightGrams('1 kg')).toBe(1000);
      expect(extractWeightGrams('2kg')).toBe(2000);
    });

    it('should parse grams', () => {
      expect(extractWeightGrams('750g')).toBe(750);
      expect(extractWeightGrams('500 g')).toBe(500);
    });

    it('should handle "ca." prefix', () => {
      expect(extractWeightGrams('ca. 700g')).toBe(700);
      expect(extractWeightGrams('ca 1 kg')).toBe(1000);
    });

    it('should handle comma decimals', () => {
      expect(extractWeightGrams('1,5 kg')).toBe(1500);
      expect(extractWeightGrams('0,5kg')).toBe(500);
    });

    it('should return null when no weight found', () => {
      expect(extractWeightGrams('Kyllingfilet')).toBeNull();
      expect(extractWeightGrams('3 stk')).toBeNull();
    });
  });

  describe('bestMatch', () => {
    const mkProduct = (id: number, name: string): OdaProduct => ({
      id,
      name,
      price: '10',
      unit: 'pk',
      available: true,
    });

    it('should return undefined for empty list', () => {
      expect(bestMatch([], 'melk')).toBeUndefined();
    });

    it('should return the single item for a one-element list', () => {
      const p = mkProduct(1, 'Lettmelk 1l');
      expect(bestMatch([p], 'melk')).toBe(p);
    });

    it('should prefer product with more matching terms', () => {
      const p1 = mkProduct(1, 'Gulrot baby');
      const p2 = mkProduct(2, 'Gulrot 750g');
      expect(bestMatch([p1, p2], 'gulrot 750g')).toBe(p2);
    });

    it('should give weight bonus for matching weight', () => {
      const p1 = mkProduct(1, 'Kyllingfilet ca. 350g');
      const p2 = mkProduct(2, 'Kyllingfilet ca. 700g');
      expect(bestMatch([p1, p2], 'kyllingfilet 700g')).toBe(p2);
    });

    it('should penalize wrong weight', () => {
      const p1 = mkProduct(1, 'Ost 150g');
      const p2 = mkProduct(2, 'Ost 1kg');
      expect(bestMatch([p1, p2], 'ost 150g')).toBe(p1);
    });

    it('should handle query with no weight gracefully', () => {
      const p1 = mkProduct(1, 'Melk 1l');
      const p2 = mkProduct(2, 'Melk lett');
      // No weight in query — pure term matching
      const result = bestMatch([p1, p2], 'melk lett');
      expect(result).toBe(p2);
    });
  });

  describe('extractPackCount', () => {
    it('should detect ×-style multi-packs', () => {
      expect(extractPackCount('Finhakkede tomater 3×400g')).toBe(3);
    });

    it('should detect x-style multi-packs', () => {
      expect(extractPackCount('Hermetiske tomater 3x400g')).toBe(3);
    });

    it('should detect -pak suffix', () => {
      expect(extractPackCount('Yoghurt 6-pak')).toBe(6);
    });

    it('should detect -pack suffix', () => {
      expect(extractPackCount('Cola 4-pack')).toBe(4);
    });

    it('should detect pk suffix', () => {
      expect(extractPackCount('Juice 3pk')).toBe(3);
    });

    it('should return 1 for non-multipacks', () => {
      expect(extractPackCount('Melk 1l')).toBe(1);
      expect(extractPackCount('Kjøttdeig 400g')).toBe(1);
    });
  });

  describe('bestMatch extra-word penalty', () => {
    const mkProduct = (id: number, name: string): OdaProduct => ({
      id,
      name,
      price: '10',
      unit: 'pk',
      available: true,
    });

    it('should penalize products with extra qualifying words', () => {
      const plain = mkProduct(1, 'Kjøttdeig 400g');
      const kylling = mkProduct(2, 'Kylling kjøttdeig 400g');
      expect(bestMatch([plain, kylling], 'kjøttdeig 400g')).toBe(plain);
    });

    it('should reject products with zero matching query terms', () => {
      const wrong = mkProduct(1, 'Kjøttkaker med løk 355g');
      const also_wrong = mkProduct(2, 'Koteletter 500g');
      expect(bestMatch([wrong, also_wrong], 'kjøttdeig 800g')).toBeUndefined();
    });

    it('should still match when query terms are present despite extras', () => {
      const product = mkProduct(1, 'Kylling kjøttdeig 400g');
      // Only one candidate — single item is returned directly
      // With two candidates, verify the one with matching terms wins
      const unrelated = mkProduct(2, 'Epler Røde');
      expect(bestMatch([product, unrelated], 'kjøttdeig')).toBe(product);
    });
  });

  describe('bestMatch quantity adjustment integration', () => {
    it('should calculate adjusted quantity for multi-packs', () => {
      // Simulating the logic from handleSyncOdaCart
      const packCount = extractPackCount('Finhakkede tomater 3×400g');
      const requestedQty = 2;
      const adjusted = Math.max(1, Math.ceil(requestedQty / packCount));
      expect(adjusted).toBe(1); // ceil(2/3) = 1
    });

    it('should not reduce below 1 for multi-packs', () => {
      const packCount = extractPackCount('Brus 6-pack');
      const adjusted = Math.max(1, Math.ceil(1 / packCount));
      expect(adjusted).toBe(1);
    });

    it('should pass through quantity for non-multipacks', () => {
      const packCount = extractPackCount('Melk 1l');
      const adjusted = Math.max(1, Math.ceil(3 / packCount));
      expect(adjusted).toBe(3);
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
