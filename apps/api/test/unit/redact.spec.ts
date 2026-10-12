import { REDACTED, isSensitiveKey, mask, redact } from '@ctp/shared';

describe('redact', () => {
  it('removes secrets by key name, recursively', () => {
    const input = {
      email: 'a@b.com',
      password: 'p',
      nested: { accessToken: 'x', refresh_token: 'y', api_secret: 's', totp: '123456', list: [{ apiKey: 'k' }] },
      instrumentToken: '256265',
      symbolToken: '99926000',
    };
    const out = redact(input);
    expect(out.email).toBe('a@b.com');
    expect(out.password).toBe(REDACTED);
    expect(out.nested.accessToken).toBe(REDACTED);
    expect(out.nested.refresh_token).toBe(REDACTED);
    expect(out.nested.api_secret).toBe(REDACTED);
    expect(out.nested.totp).toBe(REDACTED);
    expect((out.nested.list[0] as { apiKey: string }).apiKey).toBe(REDACTED);
    // Public market identifiers are not secrets.
    expect(out.instrumentToken).toBe('256265');
    expect(out.symbolToken).toBe('99926000');
    // Input is not mutated.
    expect(input.password).toBe('p');
  });

  it.each(['request_token', 'feedToken', 'jwtToken', 'Authorization', 'set-cookie', 'mpin', 'checksum'])('treats %s as sensitive', (k) => {
    expect(isSensitiveKey(k)).toBe(true);
  });

  it.each(['mapping', 'shipping', 'tokenStatus', 'brokerOrderId', 'reason'])('does not treat %s as sensitive', (k) => {
    expect(isSensitiveKey(k)).toBe(false);
  });

  it('masks values', () => {
    expect(mask('AB1234')).toBe('**1234');
    expect(mask(null)).toBeNull();
  });
});
