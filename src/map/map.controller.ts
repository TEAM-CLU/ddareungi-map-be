import {
  Controller,
  Get,
  InternalServerErrorException,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { readFile } from 'fs/promises';
import { join } from 'path';

@Controller()
export class MapController {
  constructor(private readonly configService: ConfigService) {}

  @Get('map')
  async getMap(@Res() res: Response) {
    const kakaoMapApiKey = this.configService.get<string>('KAKAO_MAP_API');
    if (!kakaoMapApiKey) {
      throw new InternalServerErrorException(
        'KAKAO_MAP_API 환경변수가 설정되지 않았습니다.',
      );
    }

    // 템플릿 HTML
    const templatePath = join(process.cwd(), 'public', 'map.html');
    let html = await readFile(templatePath, 'utf-8');

    // 하드코딩 키(appkey=...)가 남아있어도 placeholder로 강제 치환
    html = html.replace(/appkey=([^&"']+)/g, 'appkey=__KAKAO_MAP_API__');
    html = html.replaceAll(
      '__KAKAO_MAP_API__',
      encodeURIComponent(kakaoMapApiKey),
    );

    // 정적 서빙이 비활성화되므로, 필요한 JS는 모두 인라인으로 주입
    const jsFiles = [
      'myLocation.js',
      'routing.js',
      'navigation.js',
      'search.js',
      'station.js',
      'bookmark.js',
    ] as const;

    const scripts = await Promise.all(
      jsFiles.map(async (name) => {
        const p = join(process.cwd(), 'public', name);
        const code = await readFile(p, 'utf-8');
        return `\n<!-- inlined: ${name} -->\n<script>\n${code}\n</script>\n`;
      }),
    );

    // 기존 템플릿이 <script src="/...">를 포함하더라도 정적 서빙이 꺼져있으므로 제거
    html = html.replace(
      /<script\s+src="\/(myLocation|routing|navigation|search|station|bookmark)\.js"\s*><\/script>\s*/g,
      '',
    );

    // </body> 앞에 인라인 스크립트 삽입
    html = html.replace('</body>', `${scripts.join('\n')}</body>`);

    return res
      .status(200)
      .set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      .send(html);
  }

  @Get('auth_result.html')
  async getAuthResultHtml(@Res() res: Response) {
    const filePath = join(process.cwd(), 'public', 'auth_result.html');
    const html = await readFile(filePath, 'utf-8');

    return res
      .status(200)
      .set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      .send(html);
  }
}
