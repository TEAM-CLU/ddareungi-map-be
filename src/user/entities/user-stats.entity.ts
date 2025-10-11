import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, JoinColumn, OneToOne } from 'typeorm';
import { User } from './user.entity';

@Entity('user_stats')
export class UserStats {
  @PrimaryColumn({ name: 'user_id' })
  userId: number;

  @Column({ type: 'bigint', name: 'total_usage_time', default: 0 })
  totalUsageTime: number;

  @Column({ type: 'double precision', name: 'total_usage_distance', default: 0.0 })
  totalUsageDistance: number;

  @Column({ type: 'double precision', name: 'total_carbon_footprint', default: 0.0 })
  totalCarbonFootprint: number;

  @Column({ type: 'integer', name: 'total_trees_planted', default: 0 })
  totalTreesPlanted: number;

  @Column({ type: 'double precision', name: 'total_calories_burned', default: 0.0 })
  totalCaloriesBurned: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // User와의 관계 설정
  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}