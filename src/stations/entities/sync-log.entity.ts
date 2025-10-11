import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum SyncStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum SyncType {
  WEEKLY_AUTO = 'weekly_auto',
  MANUAL = 'manual',
  STARTUP_CHECK = 'startup_check',
}

@Entity('sync_logs')
export class SyncLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    type: 'enum',
    enum: SyncType,
    default: SyncType.MANUAL,
  })
  sync_type: SyncType;

  @CreateDateColumn()
  started_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date | null;

  @Column({
    type: 'enum',
    enum: SyncStatus,
    default: SyncStatus.RUNNING,
  })
  status: SyncStatus;

  @Column({ type: 'int', default: 0 })
  stations_total: number;

  @Column({ type: 'int', default: 0 })
  stations_created: number;

  @Column({ type: 'int', default: 0 })
  stations_updated: number;

  @Column({ type: 'int', default: 0 })
  stations_failed: number;

  @Column({ type: 'text', nullable: true })
  error_message: string | null;
}
