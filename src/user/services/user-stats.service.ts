import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserStats } from '../entities/user-stats.entity';
import { UpdateUserStatsDto } from '../dto/update-user-stats.dto';
import { UserStatsResponseDto } from '../dto/user-stats-response.dto';

@Injectable()
export class UserStatsService {
  constructor(
    @InjectRepository(UserStats)
    private readonly userStatsRepository: Repository<UserStats>,
  ) {}

  /**
   * 사용자 통계 업데이트 또는 생성
   */
  async updateUserStats(
    userId: number,
    updateUserStatsDto: UpdateUserStatsDto,
  ): Promise<UserStatsResponseDto> {
    const {
      totalDistance,
      totalTime,
      calories,
      plantingTree,
      carbonReduction,
    } = updateUserStatsDto;

    // 기존 사용자 통계 조회
    let userStats = await this.userStatsRepository.findOne({
      where: { userId },
    });

    if (!userStats) {
      // 새로운 사용자 통계 생성
      userStats = this.userStatsRepository.create({
        userId,
        totalUsageTime: totalTime,
        totalUsageDistance: totalDistance,
        totalCarbonFootprint: carbonReduction,
        totalTreesPlanted: plantingTree,
        totalCaloriesBurned: calories,
      });
    } else {
      // 기존 통계에 누적
      userStats.totalUsageTime += totalTime;
      userStats.totalUsageDistance += totalDistance;
      userStats.totalCarbonFootprint += carbonReduction;
      userStats.totalTreesPlanted += plantingTree;
      userStats.totalCaloriesBurned += calories;
    }

    // 저장
    const savedStats = await this.userStatsRepository.save(userStats);

    return {
      userId: savedStats.userId,
      totalUsageTime: savedStats.totalUsageTime,
      totalUsageDistance: savedStats.totalUsageDistance,
      totalCarbonFootprint: savedStats.totalCarbonFootprint,
      totalTreesPlanted: savedStats.totalTreesPlanted,
      totalCaloriesBurned: savedStats.totalCaloriesBurned,
      updatedAt: savedStats.updatedAt,
    };
  }

  /**
   * 사용자 통계 조회
   */
  async getUserStats(userId: number): Promise<UserStatsResponseDto> {
    const userStats = await this.userStatsRepository.findOne({
      where: { userId },
    });

    if (!userStats) {
      throw new NotFoundException('사용자 통계를 찾을 수 없습니다.');
    }

    return {
      userId: userStats.userId,
      totalUsageTime: userStats.totalUsageTime,
      totalUsageDistance: userStats.totalUsageDistance,
      totalCarbonFootprint: userStats.totalCarbonFootprint,
      totalTreesPlanted: userStats.totalTreesPlanted,
      totalCaloriesBurned: userStats.totalCaloriesBurned,
      updatedAt: userStats.updatedAt,
    };
  }

  /**
   * 사용자 통계 초기화
   */
  async resetUserStats(userId: number): Promise<void> {
    const userStats = await this.userStatsRepository.findOne({
      where: { userId },
    });

    if (!userStats) {
      throw new NotFoundException('사용자 통계를 찾을 수 없습니다.');
    }

    userStats.totalUsageTime = 0;
    userStats.totalUsageDistance = 0;
    userStats.totalCarbonFootprint = 0;
    userStats.totalTreesPlanted = 0;
    userStats.totalCaloriesBurned = 0;

    await this.userStatsRepository.save(userStats);
  }
}
