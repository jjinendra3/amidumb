import { describe, expect, it } from 'vitest';
import { countSecrets, redactSecrets } from '../src/signals/secrets';

// Assembled at runtime so the repo never contains strings that look like live secrets.
const fake = (prefix: string, length: number, alphabet = 'A1b2C3d4E5') =>
  prefix + alphabet.repeat(Math.ceil(length / alphabet.length)).slice(0, length);

const jwt = `${fake('eyJ', 20)}.${fake('eyJ', 30)}.${fake('', 30)}`;

describe('redactSecrets', () => {
  it.each([
    ['aws-access-key', fake('AKIA', 16, 'ABCDEFGH23')],
    ['github-token', fake('ghp_', 36)],
    ['anthropic-key', fake('sk-ant-api03-', 40)],
    ['openai-key', fake('sk-proj-', 48)],
    ['slack-token', fake('xoxb-', 30)],
    ['jwt', jwt],
    ['private-key', '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----'],
    ['credential-assignment', `password = "${fake('', 20)}"`],
  ])('redacts %s', (kind, secret) => {
    const { text, count } = redactSecrets(`use ${secret} here`);
    expect(count).toBe(1);
    expect(text).toContain(`[REDACTED:${kind}]`);
    expect(text).not.toContain(secret.slice(-12));
  });

  it('counts a JWT assigned to a token variable once', () => {
    expect(countSecrets(`--header 'auth-token: ${jwt}'`)).toBe(1);
  });

  it.each([
    'const token = getToken()',
    'password: hunter2',
    'set api_key in your .env',
    'the sk-learn docs',
    'see AKIA in the AWS docs',
  ])('leaves %j alone', (t) => expect(countSecrets(t)).toBe(0));
});
