import { GetPublicKeyCommand, KMSClient, SignCommand } from "@aws-sdk/client-kms";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as nodeSign, type KeyObject } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { asEs256PublicJwk, kidFor, type Es256PublicJwk } from "witness-verify";

/** ES256 signer. Signatures are IEEE P1363 (r || s), the JOSE / WebCrypto format. */
export interface Signer {
  readonly kid: string;
  readonly publicJwk: Es256PublicJwk;
  readonly description: string;
  sign(data: Uint8Array): Promise<Uint8Array>;
}

/** Development signer: an EC P-256 key kept in DATA_DIR/keys (never commit it). */
export class LocalSigner implements Signer {
  readonly description = "local EC P-256 key (DATA_DIR/keys/signing-key.pem)";

  private constructor(
    private readonly key: KeyObject,
    readonly publicJwk: Es256PublicJwk,
    readonly kid: string,
  ) {}

  static async open(dataDir: string): Promise<LocalSigner> {
    const path = join(dataDir, "keys", "signing-key.pem");
    let pem: string;
    try {
      pem = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
      pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, pem, { mode: 0o600 });
    }
    const key = createPrivateKey(pem);
    const publicJwk = asEs256PublicJwk(createPublicKey(key).export({ format: "jwk" }));
    return new LocalSigner(key, publicJwk, await kidFor("local", publicJwk));
  }

  async sign(data: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(nodeSign("sha256", data, { key: this.key, dsaEncoding: "ieee-p1363" }));
  }
}

/**
 * AWS KMS signer: the private key never leaves KMS. Requires an asymmetric
 * key with KeySpec ECC_NIST_P256 and KeyUsage SIGN_VERIFY.
 */
export class KmsSigner implements Signer {
  readonly description: string;

  private constructor(
    private readonly kms: KMSClient,
    private readonly keyId: string,
    readonly publicJwk: Es256PublicJwk,
    readonly kid: string,
  ) {
    this.description = `AWS KMS (${keyId})`;
  }

  static async open(region: string, keyId: string): Promise<KmsSigner> {
    const kms = new KMSClient({ region });
    const info = await kms.send(new GetPublicKeyCommand({ KeyId: keyId }));
    if (info.KeySpec !== "ECC_NIST_P256" || !info.PublicKey) {
      throw new Error(`KMS key ${keyId} must be ECC_NIST_P256 (got ${info.KeySpec ?? "unknown"})`);
    }
    const publicJwk = asEs256PublicJwk(createPublicKey({ key: Buffer.from(info.PublicKey), format: "der", type: "spki" }).export({ format: "jwk" }));
    return new KmsSigner(kms, keyId, publicJwk, await kidFor("kms", publicJwk));
  }

  async sign(data: Uint8Array): Promise<Uint8Array> {
    const digest = createHash("sha256").update(data).digest();
    const result = await this.kms.send(
      new SignCommand({ KeyId: this.keyId, Message: digest, MessageType: "DIGEST", SigningAlgorithm: "ECDSA_SHA_256" }),
    );
    if (!result.Signature) throw new Error("KMS returned no signature");
    return derToP1363(result.Signature);
  }
}

/** Convert an ASN.1 DER ECDSA signature (what KMS returns) to fixed-size r || s. */
export function derToP1363(der: Uint8Array, size = 32): Uint8Array {
  let offset = 0;
  const expect = (tag: number) => {
    if (der[offset++] !== tag) throw new Error("Malformed DER signature");
  };
  const readLength = () => {
    let length = der[offset++]!;
    if (length & 0x80) {
      const bytes = length & 0x7f;
      length = 0;
      for (let i = 0; i < bytes; i++) length = (length << 8) | der[offset++]!;
    }
    return length;
  };
  const readInt = () => {
    expect(0x02);
    const length = readLength();
    let value = der.subarray(offset, offset + length);
    offset += length;
    while (value.length > size && value[0] === 0) value = value.subarray(1);
    if (value.length > size) throw new Error("DER integer too large");
    const out = new Uint8Array(size);
    out.set(value, size - value.length);
    return out;
  };
  expect(0x30);
  readLength();
  const r = readInt();
  const s = readInt();
  const out = new Uint8Array(size * 2);
  out.set(r, 0);
  out.set(s, size);
  return out;
}
