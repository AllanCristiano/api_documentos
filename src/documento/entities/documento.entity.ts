import { 
  Column, 
  Entity, 
  PrimaryGeneratedColumn, 
  CreateDateColumn, 
  UpdateDateColumn 
} from 'typeorm';

// Definimos os estados possíveis do processamento
export enum StatusOcr {
  PENDENTE = 'PENDENTE',       // Na fila, aguardando
  PROCESSANDO = 'PROCESSANDO', // Worker pegou e está extraindo os dados
  CONCLUIDO = 'CONCLUIDO',     // OCR finalizado com sucesso
  ERRO = 'ERRO',               // Falha ao ler o PDF ou erro interno
}

@Entity()
export class Documento {
  @PrimaryGeneratedColumn()
  id: number;

  // ==========================================
  // 1. DADOS INICIAIS (Obrigatórios no Upload)
  // ==========================================
  
  @Column()
  type: string; // Ex: 'PORTARIA', 'DECRETO'

  @Column()
  url: string; // Caminho do arquivo salvo (MinIO ou disco)

  // ==========================================
  // 2. CONTROLE DE FLUXO (Novos campos)
  // ==========================================

  @Column({
    type: 'enum',
    enum: StatusOcr,
    default: StatusOcr.PENDENTE,
  })
  status_ocr: StatusOcr;

  @Column({ default: false })
  aprovado: boolean;

  @Column({ type: 'text', nullable: true })
  mensagem_erro: string; // Salva o log se o worker der crash no arquivo

  // ==========================================
  // 3. DADOS EXTRAÍDOS PELO OCR (Devem ser nullable)
  // ==========================================

  @Column({ nullable: true })
  number: string;

  @Column({ nullable: true })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ nullable: true })
  date: string;

  @Column({ type: 'text', nullable: true })
  fullText: string;

  // ==========================================
  // 4. AUDITORIA (Boas práticas)
  // ==========================================
  
  @CreateDateColumn()
  criado_em: Date;

  @UpdateDateColumn()
  atualizado_em: Date;
}