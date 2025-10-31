import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Atualizacao {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'date', nullable: true })
  date_total: Date;

  @Column({ type: 'date', nullable: true })
  date_portaria: Date;

  @Column({ type: 'date', nullable: true })
  date_lei_ordinaria: Date;

  @Column({ type: 'date', nullable: true })
  date_lei_complementar: Date;

  @Column({ type: 'date', nullable: true })
  date_decreto: Date;

  @Column({ type: 'date', nullable: true })
  date_emenda: Date;

  @Column({ type: 'date', nullable: true })
  date_lei_organica: Date;
}