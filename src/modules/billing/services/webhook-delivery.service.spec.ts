import { WebhookDeliveryService } from './webhook-delivery.service';
import * as crypto from 'crypto';

describe('WebhookDeliveryService', () => {
  let svc: WebhookDeliveryService;
  let fetchMock: jest.Mock;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    svc = new WebhookDeliveryService();
    fetchMock = jest.fn();
    originalFetch = global.fetch;
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('signs the body with `t=<ts>,v1=<hmac-sha256>` and returns ok=true on 200', async () => {
    fetchMock.mockResolvedValueOnce({ status: 200 } as any);
    const result = await svc.deliver('https://example.com/cb', { hello: 'world' }, 'shh');
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);

    const call = fetchMock.mock.calls[0];
    const headers = call[1].headers as Record<string, string>;
    expect(headers['X-HTS-Signature']).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);

    const sig = headers['X-HTS-Signature'];
    const ts = Number(sig.match(/t=(\d+)/)![1]);
    const v1 = sig.match(/v1=([a-f0-9]{64})/)![1];
    const payload = `${ts}.${call[1].body}`;
    const expected = crypto.createHmac('sha256', 'shh').update(payload).digest('hex');
    expect(v1).toBe(expected);
  });

  it('retries up to 3 times on 5xx then returns ok=false', async () => {
    fetchMock.mockResolvedValue({ status: 503 } as any);
    const result = await svc.deliver('https://example.com/cb', {}, 'shh');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on 4xx (404 means the partner endpoint is wrong, retry won\'t help)', async () => {
    fetchMock.mockResolvedValueOnce({ status: 404 } as any);
    const result = await svc.deliver('https://example.com/cb', {}, 'shh');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats AbortError as a transient network error (eligible for retry)', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const result = await svc.deliver('https://example.com/cb', {}, 'shh');
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
