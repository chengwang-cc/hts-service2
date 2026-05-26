import { BadRequestException } from '@nestjs/common';
import { KnowledgeCrawlerPolicyService } from './knowledge-crawler-policy.service';

describe('KnowledgeCrawlerPolicyService', () => {
  let svc: KnowledgeCrawlerPolicyService;

  beforeEach(() => {
    svc = new KnowledgeCrawlerPolicyService();
    delete process.env.KNOWLEDGE_CRAWLER_ALLOW_HTTP;
  });

  it('rejects non-https URLs by default', async () => {
    await expect(
      svc.assertAllowed('http://example.com/feed.rss'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects localhost', async () => {
    await expect(svc.assertAllowed('https://localhost/feed')).rejects.toThrow(
      /hostname not allowed/i,
    );
  });

  it('rejects the GCP/AWS metadata host', async () => {
    await expect(
      svc.assertAllowed('https://metadata.google.internal/'),
    ).rejects.toThrow(/hostname not allowed/i);
    await expect(svc.assertAllowed('https://169.254.169.254/')).rejects.toThrow(
      /hostname not allowed/i,
    );
  });

  it('rejects private/loopback IPs supplied as literals', async () => {
    await expect(svc.assertAllowed('https://127.0.0.1/')).rejects.toThrow();
    await expect(svc.assertAllowed('https://10.0.0.1/')).rejects.toThrow();
    await expect(svc.assertAllowed('https://192.168.1.5/')).rejects.toThrow();
    await expect(svc.assertAllowed('https://[::1]/')).rejects.toThrow();
  });

  it('enforces per-call host allowlist', async () => {
    await expect(
      svc.assertAllowed('https://www.cbp.gov/csms', {
        allowedHosts: ['ec.europa.eu'],
      }),
    ).rejects.toThrow(/allowlist/i);
  });
});
