import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class CryptoService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly encryptionKey: Buffer;

  constructor(private configService: ConfigService) {
    // 환경변수에서 암호화 키 (32바이트 hex string)
    const keyHex =
      this.configService.get<string>('ENCRYPTION_KEY') ||
      crypto.randomBytes(32).toString('hex');

    // hex string을 Buffer로 변환
    this.encryptionKey = Buffer.from(keyHex, 'hex');

    if (this.encryptionKey.length !== 32) {
      throw new Error(
        'ENCRYPTION_KEY must be 32 bytes (64 hex characters). Generate it with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      );
    }
  }

  /**
   * 데이터 암호화 (AES-256-GCM)
   * @param data 암호화할 평문 (예: 이메일)
   * @returns Base64 인코딩된 암호문 (IV + ciphertext + authTag 포함)
   */
  encrypt(data: string): string {
    const iv = crypto.randomBytes(16); // 16바이트 IV
    const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, iv);

    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // IV + 암호문 + authTag를 결합하여 Base64로 인코딩
    const combined = Buffer.concat([iv, Buffer.from(encrypted, 'hex'), authTag]);
    return combined.toString('base64');
  }

  /**
   * 데이터 복호화 (AES-256-GCM)
   * @param encryptedData Base64 인코딩된 암호문
   * @returns 복호화된 평문 (예: 이메일)
   */
  decrypt(encryptedData: string): string {
    try {
      const combined = Buffer.from(encryptedData, 'base64');

      // IV (16바이트), authTag (16바이트) 추출
      const iv = combined.slice(0, 16);
      const authTag = combined.slice(combined.length - 16);
      const ciphertext = combined.slice(16, combined.length - 16);

      const decipher = crypto.createDecipheriv(
        this.algorithm,
        this.encryptionKey,
        iv,
      );
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(ciphertext);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      return decrypted.toString('utf8');
    } catch (error) {
      throw new Error(`복호화 실패: ${error.message}`);
    }
  }
}
