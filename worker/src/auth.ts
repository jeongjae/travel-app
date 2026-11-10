// 본인 1명 인증: 패스키(WebAuthn) + 짧은 수명 Bearer 토큰. 쿠키를 쓰지 않는다.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import { aiV2JobLimits } from '../../src/ai-v2-contract.ts';
import { AiV2RequestError } from '../../src/ai-v2-jobs-core.ts';
import type { AiStore } from './store.ts';

export type AuthConfig = {
  rpId: string;
  rpName: string;
  /** WebAuthn origin 고정 비교 목록. 환경별 설정 값이며 코드 분기가 아니다. */
  origins: string[];
  tokenSecret: string;
  registrationCode: string;
};

const encoder = new TextEncoder();

export const minRegistrationCodeLength = 16;
export const maxRegistrationFailures = 5;
export const registrationLockedMessage =
  '등록 코드가 5회 틀려 등록을 잠갔습니다. 비밀값을 바꾸고 잠금 설정을 지운 뒤 다시 등록하세요.';

export function toBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** 길이가 같아도 내용에 따라 시간이 달라지지 않게 비교한다. 등록 코드·서명 비교에 쓴다. */
async function sameSecret(a: string, b: string) {
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const x = new Uint8Array(left);
  const y = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < x.length; index++) {
    difference |= x[index] ^ y[index];
  }
  return difference === 0;
}

export type TokenClaims = { v: 1; jti: string; iat: number; exp: number };

/** 인증 실패. `token_expired`와 `unauthorized`를 나눠 화면이 재로그인 안내를 고를 수 있게 한다. */
export class AuthError extends AiV2RequestError {}

export class Auth {
  private config: AuthConfig;
  private store: AiStore;
  private now: () => number;
  private key?: Promise<CryptoKey>;
  constructor(config: AuthConfig, store: AiStore, now: () => number) {
    this.config = config;
    this.store = store;
    this.now = now;
  }

  private signingKey() {
    if (!this.config.tokenSecret || this.config.tokenSecret.length < 32) {
      throw new AiV2RequestError(503, 'not_configured', 'Worker 토큰 서명 키(TOKEN_SECRET, 32자 이상)가 없습니다.');
    }
    this.key ??= crypto.subtle.importKey(
      'raw',
      encoder.encode(this.config.tokenSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
    return this.key;
  }

  async issueToken() {
    const iat = this.now();
    const claims: TokenClaims = { v: 1, jti: crypto.randomUUID(), iat, exp: iat + aiV2JobLimits.tokenLifetimeMs };
    const body = toBase64Url(encoder.encode(JSON.stringify(claims)));
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await this.signingKey(), encoder.encode(body)));
    return { token: `${body}.${toBase64Url(signature)}`, expiresAt: new Date(claims.exp).toISOString() };
  }

  /** Bearer 토큰 검사. 서명 키를 바꾸면 이전 토큰은 모두 무효가 된다(전체 해지). */
  async verify(header: string | null): Promise<TokenClaims> {
    const match = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(header ?? '');
    if (!match) {
      throw new AuthError(401, 'unauthorized', '로그인이 필요합니다.');
    }
    let valid = false;
    try {
      valid = await crypto.subtle.verify(
        'HMAC',
        await this.signingKey(),
        fromBase64Url(match[2]),
        encoder.encode(match[1]),
      );
    } catch (error) {
      if (error instanceof AiV2RequestError) {
        throw error;
      }
      valid = false;
    }
    if (!valid) {
      throw new AuthError(401, 'unauthorized', '로그인이 필요합니다.');
    }
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(match[1]))) as TokenClaims;
    if (claims.v !== 1 || typeof claims.exp !== 'number' || typeof claims.jti !== 'string') {
      throw new AuthError(401, 'unauthorized', '로그인이 필요합니다.');
    }
    if (claims.exp <= this.now()) {
      throw new AuthError(401, 'token_expired', '로그인이 만료되었습니다. 패스키로 다시 로그인하세요.');
    }
    if (this.store.isRevoked(claims.jti, this.now())) {
      throw new AuthError(401, 'unauthorized', '로그아웃된 토큰입니다. 다시 로그인하세요.');
    }
    return claims;
  }

  revoke(claims: TokenClaims) {
    this.store.revoke(claims.jti, claims.exp);
  }

  registered() {
    return this.store.credentials().length > 0;
  }

  /** 등록 코드가 5회 틀려 잠겼는지. 해제는 비밀값 교체 뒤 settings의 잠금 행을 지우는 운영 절차뿐이다(CL-30). */
  locked() {
    return this.store.setting('registration_locked') === '1';
  }

  /**
   * 등록은 자격이 0개이고 1회 등록 코드가 맞을 때만. 첫 등록이 끝나면 코드는 다시 쓸 수 없다.
   * 코드가 16자 미만이면 설정 없음으로 보고, 틀린 코드가 누적 5회면 등록을 잠근다(CL-30).
   */
  private async assertCanRegister(code: unknown) {
    if (this.registered() || this.store.setting('registration_closed') === '1') {
      throw new AiV2RequestError(409, 'already_registered', '이미 패스키가 등록되어 있습니다. 로그인하세요.');
    }
    if (this.config.registrationCode.length < minRegistrationCodeLength) {
      throw new AiV2RequestError(
        503,
        'not_configured',
        `Worker 등록 코드(REGISTRATION_CODE, ${minRegistrationCodeLength}자 이상)가 설정되지 않았습니다.`,
      );
    }
    if (this.locked()) {
      throw new AiV2RequestError(423, 'registration_locked', registrationLockedMessage);
    }
    if (typeof code !== 'string' || !(await sameSecret(code, this.config.registrationCode))) {
      const failures = Number(this.store.setting('registration_failures') ?? 0) + 1;
      this.store.atomic(() => {
        this.store.putSetting('registration_failures', String(failures));
        if (failures >= maxRegistrationFailures) {
          this.store.putSetting('registration_locked', '1');
        }
      });
      if (failures >= maxRegistrationFailures) {
        throw new AiV2RequestError(423, 'registration_locked', registrationLockedMessage);
      }
      throw new AiV2RequestError(403, 'bad_registration_code', '등록 코드가 맞지 않습니다.');
    }
  }

  private consumeChallenge(kind: string) {
    return (challenge: string) => this.store.takeChallenge(challenge, kind, this.now());
  }

  async registrationOptions(body: { code?: unknown }) {
    await this.assertCanRegister(body.code);
    const options = await generateRegistrationOptions({
      rpName: this.config.rpName,
      rpID: this.config.rpId,
      userName: 'owner',
      userDisplayName: 'travel-app owner',
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    });
    this.store.putChallenge(options.challenge, 'register', this.now() + aiV2JobLimits.challengeLifetimeMs);
    return options;
  }

  async register(body: { code?: unknown; response?: unknown }) {
    await this.assertCanRegister(body.code);
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.response as RegistrationResponseJSON,
        expectedChallenge: this.consumeChallenge('register'),
        expectedOrigin: this.config.origins,
        expectedRPID: this.config.rpId,
        requireUserVerification: true,
      });
    } catch {
      throw new AiV2RequestError(400, 'registration_failed', '패스키 등록을 확인하지 못했습니다. 다시 시도하세요.');
    }
    if (!verification.verified) {
      throw new AiV2RequestError(400, 'registration_failed', '패스키 등록을 확인하지 못했습니다. 다시 시도하세요.');
    }
    const { credential } = verification.registrationInfo;
    // 확인 사이에 다른 등록이 끝났으면 받지 않는다(0개일 때만).
    if (this.registered()) {
      throw new AiV2RequestError(409, 'already_registered', '이미 패스키가 등록되어 있습니다. 로그인하세요.');
    }
    this.store.addCredential(
      {
        id: credential.id,
        publicKey: toBase64Url(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? [],
      },
      new Date(this.now()).toISOString(),
    );
    this.store.putSetting('registration_closed', '1');
    return this.issueToken();
  }

  async loginOptions() {
    const credentials = this.store.credentials();
    if (!credentials.length) {
      throw new AiV2RequestError(409, 'not_registered', '등록된 패스키가 없습니다. 먼저 등록하세요.');
    }
    const options = await generateAuthenticationOptions({
      rpID: this.config.rpId,
      allowCredentials: credentials.map((credential) => ({
        id: credential.id,
        transports: credential.transports as NonNullable<WebAuthnCredential['transports']>,
      })),
      userVerification: 'required',
    });
    this.store.putChallenge(options.challenge, 'login', this.now() + aiV2JobLimits.challengeLifetimeMs);
    return options;
  }

  async login(body: { response?: unknown }) {
    const response = body.response as AuthenticationResponseJSON | undefined;
    const credential = this.store.credentials().find((candidate) => candidate.id === response?.id);
    if (!response || !credential) {
      throw new AiV2RequestError(401, 'login_failed', '등록된 패스키가 아닙니다.');
    }
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: this.consumeChallenge('login'),
        expectedOrigin: this.config.origins,
        expectedRPID: this.config.rpId,
        credential: {
          id: credential.id,
          publicKey: fromBase64Url(credential.publicKey),
          counter: credential.counter,
          transports: credential.transports,
        },
        requireUserVerification: true,
      });
    } catch {
      throw new AiV2RequestError(401, 'login_failed', '패스키 로그인을 확인하지 못했습니다.');
    }
    if (!verification.verified) {
      throw new AiV2RequestError(401, 'login_failed', '패스키 로그인을 확인하지 못했습니다.');
    }
    this.store.updateCounter(credential.id, verification.authenticationInfo.newCounter);
    return this.issueToken();
  }
}
