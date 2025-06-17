import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Documento {
  @PrimaryGeneratedColumn()
  id: number;
  @Column()
  type: string;
  @Column()
  number: string;
  @Column()
  title: string;
  @Column()
  description: string;
  @Column()
  date: string;
  @Column()
  url: string;
  @Column()
  fullText: string;
}
