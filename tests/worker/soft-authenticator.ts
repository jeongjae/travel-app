// 시험용 소프트웨어 패스키(ES256, attestation "none"). 브라우저 없이 서버 검증 경로를 실제로 통과시킨다.
import { fromBase64Url, toBase64Url } from '../../worker/src/auth.ts';

type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;

function head(major: number, length: number) {
  if (length < 24) {
    return [(major << 5) | length];
  }
  if (length < 256) {
    return [(major << 5) | 24, length];
  }
  return [(major << 5) | 25, length >> 8, length & 0xff];
}

function cbor(value: Cbor): number[] {
  if (typeof value === 'number') {
    return value >= 0 ? head(0, value) : head(1, -1 - value);
  }
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value);
    return [...head(3, bytes.length), ...bytes];
  }
  if (value instanceof Uint8Array) {
    return [...head(2, value.length), ...value];
  }
  const out = head(5, value.size);
  for (const [key, entry] of value) {
    out.push(...cbor(key), ...cbor(entry));
  }
  return out;
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const sha256 = async (bytes: Uint8Array<ArrayBuffer>) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));

/** WebCrypto의 r||s 서명을 WebAuthn이 요구하는 DER로 바꾼다. */
function derSignature(raw: Uint8Array) {
  const integer = (bytes: Uint8Array) => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) {
      start++;
    }
    const trimmed = bytes.slice(start);
    const padded = trimmed[0] & 0x80 ? concat(new Uint8Array([0]), trimmed) : trimmed;
    return concat(new Uint8Array([0x02, padded.length]), padded);
  };
  const body = concat(integer(raw.slice(0, 32)), integer(raw.slice(32)));
  return concat(new Uint8Array([0x30, body.length]), body);
}

export async function softAuthenticator() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const credentialId = crypto.getRandomValues(new Uint8Array(16));
  const id = toBase64Url(credentialId);
  let counter = 0;
  const cose = new Map<Cbor, Cbor>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, fromBase64Url(jwk.x!)],
    [-3, fromBase64Url(jwk.y!)],
  ]);
  const authData = async (rpId: string, flags: number, attested?: Uint8Array) => {
    const count = new Uint8Array([
      (counter >>> 24) & 255,
      (counter >>> 16) & 255,
      (counter >>> 8) & 255,
      counter & 255,
    ]);
    return concat(
      await sha256(new TextEncoder().encode(rpId)),
      new Uint8Array([flags]),
      count,
      attested ?? new Uint8Array(),
    );
  };
  const clientData = (type: string, challenge: string, origin: string) =>
    new TextEncoder().encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  return {
    id,
    async register(challenge: string, origin: string, rpId = 'localhost') {
      const attested = concat(
        new Uint8Array(16),
        new Uint8Array([0, credentialId.length]),
        credentialId,
        new Uint8Array(cbor(cose)),
      );
      // UP(0x01) | UV(0x04) | AT(0x40)
      const data = await authData(rpId, 0x45, attested);
      const attestation = new Map<Cbor, Cbor>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', data],
      ]);
      return {
        id,
        rawId: id,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: toBase64Url(clientData('webauthn.create', challenge, origin)),
          attestationObject: toBase64Url(new Uint8Array(cbor(attestation))),
          transports: ['internal'],
        },
      };
    },
    async login(challenge: string, origin: string, rpId = 'localhost') {
      counter += 1;
      const data = await authData(rpId, 0x05);
      const client = clientData('webauthn.get', challenge, origin);
      const signed = concat(data, await sha256(client));
      const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, signed));
      return {
        id,
        rawId: id,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: toBase64Url(client),
          authenticatorData: toBase64Url(data),
          signature: toBase64Url(derSignature(raw)),
        },
      };
    },
  };
}
