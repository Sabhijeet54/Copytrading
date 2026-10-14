import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SaveBrokerApiConfigDto } from '../../src/brokers/brokers.module';

const check = (body: Record<string, unknown>) => {
  const dto = plainToInstance(SaveBrokerApiConfigDto, body);
  return { dto, errors: validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }) };
};

describe('SaveBrokerApiConfigDto', () => {
  it('accepts a full Angel One form and trims / upper-cases', () => {
    const { dto, errors } = check({
      clientCode: ' s1832564 ',
      apiKey: ' abc ',
      pin: '1234',
      totpSecret: 'GEZDGNBVGY3TQOJQ',
      proxyHost: '103.25.10.20',
      proxyPort: '3128',
      proxyUser: 'u',
      proxyPass: 'p',
      autoLogin: true,
      consent: true,
    });
    expect(errors).toHaveLength(0);
    expect(dto.clientCode).toBe('S1832564');
    expect(dto.apiKey).toBe('abc');
    expect(dto.proxyPort).toBe(3128);
  });

  it('allows empty secret fields (keep what is stored)', () => {
    expect(check({ apiKey: '', pin: '', proxyPass: '' }).errors).toHaveLength(0);
  });

  it.each([
    [{ pin: '12' }, 'pin'],
    [{ proxyPort: 70000 }, 'proxyPort'],
    [{ clientCode: 'bad code!' }, 'clientCode'],
    [{ unknownField: 'x' }, 'unknownField'],
  ])('rejects %o', (body, field) => {
    expect(check(body).errors.map((e) => e.property)).toContain(field);
  });
});
