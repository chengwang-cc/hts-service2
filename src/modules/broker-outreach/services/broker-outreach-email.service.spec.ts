import {
  BrokerOutreachEmailService,
  LogOnlyOutreachEmailProvider,
} from './broker-outreach-email.service';

describe('BrokerOutreachEmailService', () => {
  let service: BrokerOutreachEmailService;

  beforeEach(() => {
    service = new BrokerOutreachEmailService(new LogOnlyOutreachEmailProvider());
  });

  it('sends through the log-only provider by default', async () => {
    const result = await service.send({
      to: 'hello@example.com',
      subject: 'Test',
      body: 'Body',
    });
    expect(result.status).toBe('sent');
    expect(result.provider).toBe('log-only');
    expect(result.messageId).toMatch(/^log-/);
  });

  it('suppresses repeated sends to a suppressed address', async () => {
    service.suppress('Block@Example.com', 'unsubscribed');
    expect(service.isSuppressed('block@example.com')).toBe(true);
    const result = await service.send({
      to: 'BLOCK@example.com',
      subject: 'Test',
      body: 'Body',
    });
    expect(result.status).toBe('suppressed');
  });

  it('lists suppression entries lowercased and sorted', () => {
    service.suppress('zeta@example.com');
    service.suppress('alpha@example.com');
    expect(service.listSuppressed()).toEqual([
      'alpha@example.com',
      'zeta@example.com',
    ]);
  });

  it('unsuppress removes the entry and returns true', () => {
    service.suppress('x@example.com');
    expect(service.unsuppress('X@Example.com')).toBe(true);
    expect(service.unsuppress('x@example.com')).toBe(false);
  });

  it('rejects empty envelope.to', async () => {
    await expect(
      service.send({ to: '', subject: 'x', body: 'y' }),
    ).rejects.toThrow();
  });
});
