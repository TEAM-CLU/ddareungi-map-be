import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('increment', { name: 'user_id' })
  userId: number;

  @Column({ type: 'varchar', length: 255, unique: true, nullable: true, name: 'social_uid' })
  socialUid: string;

  @Column({ type: 'varchar', length: 255, unique: true})
  email: string;

  @Column({ type: 'varchar', length: 255, name: 'password_hash'})
  passwordHash: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 10})
  gender: string;

  @Column({ type: 'date', name: 'birth_date'})
  birthDate: Date;

  @Column({ type: 'varchar', length: 20, unique: true, name: 'phone_number' })
  phoneNumber: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;

  @Column({ type: 'timestamptz', name: 'last_login', nullable: true })
  lastLogin: Date;
}