import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  /**
   *
   * @param createUserDto
   * @param passwordHash
   * @returns
   */
  async create(
    createUserDto: Omit<CreateUserDto, 'password'>,
    passwordHash: string,
  ): Promise<User> {
    const newUser = this.usersRepository.create({
      ...createUserDto,
      passwordHash,
    });
    return this.usersRepository.save(newUser);
  }

  async findAll(): Promise<User[] | null> {
    return this.usersRepository.find();
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ email });
  }

  async updateLastLogin(userId: number): Promise<void> {
    await this.usersRepository.update(userId, { lastLogin: new Date() });
  }
}
