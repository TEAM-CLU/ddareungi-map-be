import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type { Point } from 'geojson';

@Entity('stations')
@Index('idx_stations_location', ['location'], { spatial: true })
export class Station {
  @PrimaryColumn({
    type: 'varchar',
    length: 50,
    comment: 'Seoul API Station ID (e.g., ST-3060)',
  })
  id: string;

  @Column({
    type: 'varchar',
    length: 255,
  })
  name: string;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  number: string | null; // RENT_NO

  @Column({ type: 'varchar', length: 100, nullable: true })
  district: string | null; // STA_LOC

  @Column({ type: 'varchar', length: 255, nullable: true })
  address: string | null; // STA_ADD1 + STA_ADD2

  @Column({
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
  })
  location: Point;

  @Column({ type: 'int', default: 0 })
  total_racks: number; // HOLD_NUM

  @Column({ type: 'int', default: 0 })
  current_adult_bikes: number;

  @Column({
    type: 'enum',
    enum: ['available', 'empty', 'inactive'],
    default: 'available',
    comment:
      'Station availability status: available(자전거 있음), empty(빈 대여소), inactive(사용불가)',
  })
  status: 'available' | 'empty' | 'inactive';

  @Column({ type: 'timestamptz', nullable: true })
  last_updated_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
