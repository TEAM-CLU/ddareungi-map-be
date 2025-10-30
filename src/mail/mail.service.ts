import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        // .env 파일에 추가할 정보:
        // MAIL_USER=your-email@gmail.com
        // MAIL_PASS=your-app-password (구글 앱 비밀번호)
        user: this.configService.get<string>('MAIL_USER'),
        pass: this.configService.get<string>('MAIL_PASS'),
      },
    });
  }

  /**
   * 이메일 인증 코드 발송
   * @param to 받는 사람 이메일
   * @param verificationCode 인증 코드
   */
  async sendVerificationEmail(
    to: string,
    verificationCode: string,
  ): Promise<void> {
    const mailOptions = {
      from: this.configService.get<string>('MAIL_USER'), // 발송자 이메일
      to: to, // 받는 사람 이메일
      subject: '[따릉이맵] 이메일 인증',
      html: `
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
          <h2 style="color: #2563eb; text-align: center;">따릉이맵 이메일 인증</h2>
          <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p>안녕하세요!</p>
            <p>따릉이맵 서비스 이용을 위한 이메일 인증을 진행해주세요.</p>
            <div style="text-align: center; margin: 30px 0;">
              <div style="background-color: #2563eb; color: white; padding: 15px 30px; border-radius: 6px; font-size: 24px; font-weight: bold; letter-spacing: 4px; display: inline-block;">
                ${verificationCode}
              </div>
            </div>
            <p><strong>인증 코드:</strong> ${verificationCode}</p>
            <p style="color: #ef4444;">이 인증 코드는 10분 후 만료됩니다.</p>
            <p style="color: #6b7280; font-size: 14px;">본인이 요청하지 않은 인증이라면 이 이메일을 무시해주세요.</p>
          </div>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
          <p style="text-align: center; color: #6b7280; font-size: 14px;">
            © 2025 따릉이맵. All rights reserved.
          </p>
        </div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`인증 이메일 발송 성공: ${to}`);
    } catch (error) {
      console.error('이메일 발송 실패:', error);
      throw new Error('이메일 발송에 실패했습니다.');
    }
  }

  /**
   * 일반 알림 이메일 발송
   * @param to 받는 사람 이메일
   * @param subject 제목
   * @param content 내용
   */
  async sendNotificationEmail(
    to: string,
    subject: string,
    content: string,
  ): Promise<void> {
    const mailOptions = {
      from: this.configService.get<string>('MAIL_USER'),
      to: to,
      subject: `[따릉이맵] ${subject}`,
      html: `
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
          <h2 style="color: #2563eb; text-align: center;">따릉이맵</h2>
          <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #1f2937;">${subject}</h3>
            <div style="line-height: 1.6; color: #374151;">
              ${content}
            </div>
          </div>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
          <p style="text-align: center; color: #6b7280; font-size: 14px;">
            © 2025 따릉이맵. All rights reserved.
          </p>
        </div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`알림 이메일 발송 성공: ${to}`);
    } catch (error) {
      console.error('알림 이메일 발송 실패:', error);
      throw new Error('알림 이메일 발송에 실패했습니다.');
    }
  }
}
