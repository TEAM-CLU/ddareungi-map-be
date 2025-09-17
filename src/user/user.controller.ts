import { Controller, Post, Body, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { UserService } from './user.service';
import { 
  CreateUserDto
} from './dto/create-user.dto';
import { LoginUserDto } from './dto/login-user.dto';

@ApiTags('유저 (User)')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post('create-user')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: '유저 회원가입 (임시)',
    description: '지정된 형식을 통하여 회원가입을 진행합니다.'
  })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({ 
    status: 200, 
    description: '회원가입 성공',
    schema: {
      example: {
        message: '회원가입이 완료되었습니다.'
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: '잘못된 요청 (이메일 형식 오류, 재전송 시간 제한 등)',
    schema: {
      example: {
        statusCode: 400,
        message: '회원가입에 실패하였습니다. 다시 시도해주세요',
        error: 'Bad Request'
      }
    }
  })
  async createUser(@Body() createUserDto: CreateUserDto) {
    return await this.userService.register(createUserDto);
  }

  @Post('login-user')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: '유저 로그인',
    description: '지정된 형식을 통하여 로그인을 진행합니다.'
  })
  @ApiBody({ type: LoginUserDto })
  @ApiResponse({ 
    status: 200, 
    description: '로그인 성공',
    schema: {
      example: {
        message: '로그인이 완료되었습니다.'
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: '잘못된 요청 (이메일 오류, 비밀번호 오류)',
    schema: {
      example: {
        statusCode: 400,
        message: '로그인에 실패하였습니다. 다시 시도해주세요',
        error: 'Bad Request'
      }
    }
  })
  async loginUser(@Body() loginUserDto: LoginUserDto) {
    return await this.userService.login(loginUserDto);
  }

  
}
