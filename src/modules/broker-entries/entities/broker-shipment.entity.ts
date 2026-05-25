import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('broker_shipments')
@Index(['brokerOrganizationId'])
@Index(['clientId'])
@Index(['status'])
@Index(['mode'])
@Index(['eta'])
export class BrokerShipmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  brokerOrganizationId: string;

  @Column('uuid')
  clientId: string;

  @Column('varchar', { length: 80, nullable: true })
  shipmentReference: string | null;

  @Column('varchar', { length: 40, default: 'ocean' })
  mode: 'ocean' | 'air' | 'truck' | 'rail' | 'parcel' | 'multimodal';

  @Column('varchar', { length: 160, nullable: true })
  carrierName: string | null;

  @Column('varchar', { length: 80, nullable: true })
  vesselOrFlight: string | null;

  @Column('varchar', { length: 10, nullable: true })
  originCountry: string | null;

  @Column('varchar', { length: 10, nullable: true })
  destinationCountry: string | null;

  @Column('varchar', { length: 40, nullable: true })
  portOfLading: string | null;

  @Column('varchar', { length: 40, nullable: true })
  portOfUnlading: string | null;

  @Column('timestamp', { nullable: true })
  eta: Date | null;

  @Column('varchar', { length: 40, default: 'pre_arrival' })
  status:
    | 'pre_arrival'
    | 'in_transit'
    | 'arrived'
    | 'cleared'
    | 'released'
    | 'cancelled';

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
