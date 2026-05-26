import { OutboundHttpPolicyService } from '../../src/modules/broker-adapters/adapters/outbound-http-policy.service';

describe('OutboundHttpPolicyService', () => {
  const policy = new OutboundHttpPolicyService();

  it('requires HTTPS for adapter delivery targets', async () => {
    await expect(policy.assertAllowed('http://example.com')).rejects.toThrow(
      /https/i,
    );
  });

  it('blocks localhost names before DNS lookup', async () => {
    await expect(
      policy.assertAllowed('https://localhost/hook'),
    ).rejects.toThrow(/not allowed/i);
  });

  it('blocks private and metadata IP literals', async () => {
    await expect(
      policy.assertAllowed('https://127.0.0.1/hook'),
    ).rejects.toThrow(/blocked ip/i);
    await expect(
      policy.assertAllowed('https://169.254.169.254/latest/meta-data'),
    ).rejects.toThrow(/blocked ip/i);
  });

  it('enforces explicit host allowlists before DNS lookup', async () => {
    await expect(
      policy.assertAllowed('https://example.com/hook', {
        allowedHosts: ['broker.example'],
      }),
    ).rejects.toThrow(/allowlisted/i);
  });
});
