# API de Documentos com OCR

## 📋 Visão Geral

**API de Documentos com OCR** é uma aplicação backend robusta construída com **NestJS** que realiza extração inteligente de texto em PDFs através de OCR (Optical Character Recognition) e gerencia o armazenamento seguro de documentos digitalizados. A aplicação processa documentos administrativos como **portarias, decretos, leis ordinárias e leis complementares** de forma assíncrona e eficiente.

### Principais Funcionalidades

- ✅ **Upload e processamento de PDFs** com armazenamento seguro em MinIO
- 🤖 **Extração de texto via OCR** usando Tesseract.js com reconhecimento de português
- ⚙️ **Processamento assíncrono** de documentos com fila BullMQ
- 💾 **Banco de dados PostgreSQL** para persistência de metadados
- 🔄 **Fluxo de aprovação manual** para garantir qualidade dos dados extraídos
- 📦 **API REST** para gerenciamento completo de documentos
- 🏗️ **Escalável** com suporte a processamento paralelo de múltiplos documentos

---

## 🏛️ Arquitetura e Fluxo Principal

### Diagrama do Fluxo de Dados

```
1. UPLOAD DO PDF (Cliente)
         ↓
2. Arquivo salvo em pasta temporária (./uploads)
         ↓
3. Arquivo movido para MinIO (armazenamento permanente)
         ↓
4. Job criado na fila OCR (BullMQ + Redis)
         ↓
5. OCR Processor lê o arquivo do MinIO
         ↓
6. Tesseract.js extrai texto do PDF
         ↓
7. Dados extraídos salvos no PostgreSQL
         ↓
8. Usuário visualiza dados pendentes para aprovação
         ↓
9. Usuário aprova ou rejeita dados
         ↓
10. Documento finalizado e URL formatada para público
```

### Stack Tecnológico

```
Frontend: REST API (Cliente faz requisições HTTP)
   ↓
NestJS (TypeScript) - Framework principal
   ↓
├─ PostgreSQL: Armazenamento de metadados (ORM com TypeORM)
├─ Redis: Fila de processamento (BullMQ)
├─ MinIO: Armazenamento de objetos (S3-compatível)
└─ Tesseract.js: OCR para extração de texto
```

---

## 📁 Estrutura do Projeto

```
api_documentos/
├── src/
│   ├── app.module.ts                 # Módulo raiz (configuração global)
│   ├── app.controller.ts             # Controller raiz (Hello)
│   ├── app.service.ts                # Service raiz
│   ├── main.ts                       # Ponto de entrada (bootstrap)
│   │
│   ├── documento/                    # Módulo de Gerenciamento de Documentos
│   │   ├── documento.controller.ts   # Endpoints de documentos
│   │   ├── documento.service.ts      # Lógica de negócio
│   │   ├── ocr.processor.ts          # Worker que processa a fila
│   │   ├── entities/
│   │   │   ├── documento.entity.ts   # Modelo da tabela 'documento'
│   │   │   └── update.entity.ts      # Modelo da tabela 'atualizacao'
│   │   ├── dto/
│   │   │   ├── create-documento.dto.ts   # Validação de entrada
│   │   │   └── update-documento.dto.ts
│   │   └── documento.module.ts
│   │
│   ├── files/                        # Módulo de Gerenciamento de Arquivos
│   │   ├── files.controller.ts       # Endpoints de upload
│   │   ├── files.service.ts          # Lógica de movimentação de arquivos
│   │   ├── ocr.service.ts            # Serviço de OCR (Tesseract)
│   │   ├── minio.service.ts          # Serviço de armazenamento (MinIO)
│   │   ├── entities/
│   │   │   └── file.entity.ts        # Modelo de arquivo
│   │   ├── dto/
│   │   │   ├── create-file.dto.ts
│   │   │   └── update-file.dto.ts
│   │   └── files.module.ts
│   │
│   └── types/
│       └── pdf-poppler.d.ts          # Tipagens customizadas
│
├── uploads/                          # Pasta temporária de uploads (.gitignored)
├── pdfs/                             # Cache local de PDFs (opcional)
├── docker-compose.yml                # Orquestração de serviços
├── package.json                      # Dependências Node.js
├── tsconfig.json                     # Configuração TypeScript
└── nest-cli.json                     # Configuração NestJS CLI
```

---

## 🔧 Componentes Principais

### 1. **DocumentoController** (`src/documento/documento.controller.ts`)

**Responsabilidade:** Expor endpoints REST para gerenciar documentos.

#### Endpoints Principais:

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/documento` | Cria documento PENDENTE e envia para fila OCR |
| `GET` | `/documento` | Retorna todos os documentos |
| `GET` | `/documento/:id` | Retorna um documento específico |
| `GET` | `/documento/filtrado` | Retorna documentos aprovados (sem fullText) |
| `PATCH` | `/documento/:id/aprovar` | Aprova dados extraídos pelo OCR |
| `PUT` | `/documento/:id` | Atualiza dados de um documento |
| `DELETE` | `/documento/:id` | Remove um documento |
| `GET` | `/documento/download/:filename` | Faz download do PDF |
| `PATCH` | `/documento/:id/file` | Substitui arquivo de um documento |
| `GET` | `/documento/fix/migracao-geral` | 🔥 Rota de emergência para processar documentos sem texto |
| `GET` | `/documento/fix/padronizar-todos` | Padroniza nomes de arquivos no MinIO |
| `GET` | `/documento/fix/atualizar-ementas` | Limpa e re-processa ementas |

### 2. **DocumentoService** (`src/documento/documento.service.ts`)

**Responsabilidade:** Implementar a lógica de negócio dos documentos.

#### Métodos Críticos:

- **`createPendente(type, tempFilename)`**
  - Cria um novo documento com status `PENDENTE`
  - Move arquivo do MinIO para pasta temporária
  - Enfileira job de OCR
  - Retorna documento com ID

- **`atualizarDadosOcr(id, dadosOcr)`**
  - Chamado pelo `OcrProcessor` após OCR ser executado
  - Salva número, título, data, descrição, fullText
  - Implementa trava de segurança (não sobrescreve dados já preenchidos)

- **`aprovarDocumento(id, dadosAprovados)`**
  - Marcado como `aprovado: true`
  - Renomeia arquivo no MinIO de `pendente-XXX` para nome definitivo
  - Atualiza metadados no banco de dados

- **`formatarUrlPublica(documento)`**
  - Converte URL interna do MinIO para domínio público oficial
  - Ex: `http://minio:9000/atos-normativos/...` → `https://transparenciastoragepub.aracaju.se.gov.br/atos-normativos/...`

- **`findAllNoFullText()`**
  - Retorna apenas documentos aprovados (sem conteúdo completo)
  - Usado pela rota `/filtrado` do Serigy
  - Aplica formatação de URL pública

### 3. **FilesController** (`src/files/files.controller.ts`)

**Responsabilidade:** Gerenciar upload e finalização de arquivos.

#### Endpoints:

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/files/upload-temporary-pdf` | **Etapa 1:** Faz upload do PDF para pasta temporária |
| `POST` | `/files/finalize-upload` | **Etapa 2:** Move para MinIO e enfileira OCR |

### 4. **FilesService** (`src/files/files.service.ts`)

**Responsabilidade:** Gerenciar operações de arquivo (disco → MinIO → downloads).

#### Métodos:

- **`moveTempFileToMinio(tempFilename, finalFilename)`**
  - Lê arquivo da pasta `./uploads`
  - Envia para MinIO com nome final
  - Deleta arquivo temporário após sucesso
  - Retorna URL pública

- **`downloadFileFromMinio(objectName)`**
  - Baixa arquivo do MinIO como Buffer
  - Usado pelo OCR Processor para processar o arquivo

- **`renameFileInMinio(oldKey, newKey)`**
  - Move/renomeia arquivo no MinIO
  - Usado quando documento é aprovado

### 5. **OcrService** (`src/files/ocr.service.ts`)

**Responsabilidade:** Executar OCR em PDFs e extrair informações estruturadas.

#### Fluxo de Processamento:

```
1. Recebe Buffer do PDF
   ↓
2. Converte PDF → Imagens JPEG (usando pdftoppm)
   - Resolução: 200 DPI
   - Formato: JPEG (melhor qualidade/performance)
   ↓
3. Para cada imagem:
   - Executa Tesseract.js com idioma português
   - Extrai texto puro
   - Concatena com imagens anteriores
   ↓
4. Processa texto extraído:
   - Remove caracteres inválidos (==, ||, etc)
   - Limpa espaçamentos
   - Formata quebras de linha
   ↓
5. Extrai informações estruturadas via Regex:
   - NÚMERO do documento (ex: 123/2024)
   - DATA (DD/MM/YYYY ou similar)
   - PRIMEIRO PARÁGRAFO (ementa)
   ↓
6. Salva resultado em arquivo no disco
   ↓
7. Retorna objeto com todos os dados extraídos
```

#### Regex Patterns por Tipo:

```javascript
PORTARIA:        /PORTARIA\s*(?:Nº|N\.º|N|NO)?\s*([\d./\s-]+)/i
LEI ORDINÁRIA:   /LEI\s*(?:ORDIN[ÁA]RIA)?\s*(?:Nº|N\.º|N|NO)?\s*([\d.,\s-]+)/i
LEI COMPLEMENTAR:/LEI\s+COMPLEMENTAR\s*(?:Nº|N\.º|N|NO)?\s*([\d.,\s-]+)/i
DECRETO:         /DECRETO\s*(?:Nº|N\.º|N|NO)?\s*([\d./\s-]+)/i
```

**Dependências:**
- `tesseract.js`: OCR (v6.0.1)
- `pdftoppm` (system): Conversão PDF → Imagem
- `async-mutex`: Proteção de race conditions

### 6. **OcrProcessor** (`src/documento/ocr.processor.ts`)

**Responsabilidade:** Consumir jobs da fila e processar OCR.

#### Configuração:

```javascript
@Processor('ocr-queue', {
  concurrency: 1,        // Processa UM job por vez (proteção contra sobrecarga)
  lockDuration: 300000,  // 5 minutos de trava para jobs longos
})
```

#### Fluxo de Execução:

```
1. Recebe job: { documentoId, tipo, arquivoUrl }
   ↓
2. Atualiza status para PROCESSANDO
   ↓
3. Extrai Object Key do MinIO (ex: "atos-normativos/pendente-123.pdf")
   ↓
4. Downloads do MinIO → Buffer
   ↓
5. Cria mock de Multer.File para compatibilidade com OcrService
   ↓
6. Executa OcrService.processPdf()
   ↓
7. SE SUCESSO:
   - Salva: numero_doc, data_doc, title, description, fullText
   - Status → CONCLUIDO
   ↓
8. SE ERRO:
   - Salva mensagem_erro no banco
   - Status → ERRO
   - Lança erro novamente (BullMQ retentará)
```

### 7. **MinioService** (`src/files/minio.service.ts`)

**Responsabilidade:** Abstração sobre MinIO (compatible com AWS S3).

#### Métodos:

- **`uploadFile(filePath, objectName)`**
  - Lê arquivo do disco
  - Envia para MinIO com tipo MIME `application/pdf`
  - Retorna URL pública

- **`downloadFile(objectName)`**
  - Retorna arquivo como Buffer
  - Usado para processar OCR

- **`renameFile(oldKey, newKey)`**
  - Cria cópia com novo nome
  - Deleta versão antiga

- **`onModuleInit()`**
  - Executado automaticamente ao iniciar a API
  - Verifica se bucket existe
  - Cria bucket se não existir

#### Variáveis de Ambiente:

```
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=admin
MINIO_SECRET_KEY=password
MINIO_BUCKET=atos-normativos
```

### 8. **Documento Entity** (`src/documento/entities/documento.entity.ts`)

**Responsabilidade:** Definir schema do banco de dados.

#### Campos:

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | INT | Chave primária |
| `type` | VARCHAR | Tipo: PORTARIA, LEI_ORDINARIA, DECRETO, LEI_COMPLEMENTAR |
| `url` | VARCHAR | URL completa do PDF no MinIO |
| `status_ocr` | ENUM | PENDENTE, PROCESSANDO, CONCLUIDO, ERRO |
| `aprovado` | BOOLEAN | `true` se usuário aprovou dados |
| `number` | VARCHAR | Número extraído (ex: 123/2024) |
| `title` | VARCHAR | Título formatado (ex: "PORTARIA 123/2024") |
| `date` | DATE | Data extraída |
| `description` | TEXT | Ementa/primeiro parágrafo |
| `fullText` | TEXT | Conteúdo completo do PDF |
| `mensagem_erro` | TEXT | Se status=ERRO, contém o erro |
| `created_at` | TIMESTAMP | Data de criação |
| `updated_at` | TIMESTAMP | Data da última atualização |

---

## 🚀 Como Funciona - Fluxo Completo de Um Documento

### Cenário: Usuário faz upload de uma Portaria

#### **Passo 1: Upload Temporário**
```bash
POST /files/upload-temporary-pdf
Content-Type: multipart/form-data

file: portaria_123.pdf
```

**O que acontece:**
- Multer salva em `./uploads/1609459200000-portaria_123.pdf`
- Retorna: `{ tempFilename: "1609459200000-portaria_123.pdf" }`

#### **Passo 2: Finalizar Upload**
```bash
POST /files/finalize-upload
{
  "tempFilename": "1609459200000-portaria_123.pdf",
  "finalFilename": "PORTARIA/portaria_123",
  "documentoId": "1",
  "docType": "PORTARIA"
}
```

**O que acontece:**
1. FilesService move arquivo do disco para MinIO:
   - `/uploads/1609459200000-portaria_123.pdf` → MinIO
   - Key: `PORTARIA/portaria_123.pdf`
   - URL: `http://minio:9000/atos-normativos/PORTARIA/portaria_123.pdf`

2. DocumentoService cria registro:
   ```sql
   INSERT INTO documento 
   (type, url, status_ocr, aprovado, created_at)
   VALUES
   ('PORTARIA', 'http://minio:9000/...', 'PENDENTE', false, NOW())
   ```

3. Job enfileirado no BullMQ:
   ```javascript
   ocrQueue.add('processar-pdf', {
     documentoId: 1,
     tipo: 'PORTARIA',
     arquivoUrl: 'http://minio:9000/atos-normativos/PORTARIA/portaria_123.pdf'
   })
   ```

#### **Passo 3: OCR em Background (OcrProcessor)**

Quando o worker pega o job:

1. **Download do MinIO:**
   ```javascript
   const buffer = await filesService.downloadFileFromMinio(
     'PORTARIA/portaria_123.pdf'
   )
   ```

2. **Conversão PDF → Imagens:**
   ```bash
   pdftoppm -jpeg -r 200 input.pdf page
   # Gera: page-1.jpg, page-2.jpg, ...
   ```

3. **Tesseract OCR em cada imagem:**
   ```javascript
   const worker = await createWorker('por'); // Português
   const result = await worker.recognize(imagePath);
   const texto = result.data.text;
   ```

4. **Limpeza de Texto:**
   ```
   Remove: ==, ||, ###, @@@
   Normaliza espaços: múltiplos espaços → 1 espaço
   Formata quebras de linha
   ```

5. **Extração via Regex:**
   ```javascript
   // Encontra: PORTARIA Nº 123/2024
   number = "123/2024"
   
   // Extrai primeiro parágrafo
   description = "Dispõe sobre..."
   
   // Encontra data (heurística)
   date = "2024-03-15"
   ```

6. **Atualiza Banco de Dados:**
   ```sql
   UPDATE documento 
   SET 
     status_ocr = 'CONCLUIDO',
     number = '123/2024',
     title = 'PORTARIA 123/2024',
     date = '2024-03-15',
     description = 'Dispõe sobre...',
     fullText = '(conteúdo completo)',
     updated_at = NOW()
   WHERE id = 1
   ```

#### **Passo 4: Usuário Aprova Dados**

```bash
PATCH /documento/1/aprovar
{
  "number": "123/2024",
  "title": "PORTARIA 123/2024",
  "date": "2024-03-15",
  "description": "Dispõe sobre a realização...",
  "fullText": "..."
}
```

**O que acontece:**
1. Marca `aprovado = true`
2. Renomeia arquivo no MinIO:
   - Antes: `PORTARIA/pendente-1709395200000-portaria_123.pdf`
   - Depois: `PORTARIA/PORTARIA_123_2024.pdf`
3. Atualiza URL no banco de dados
4. Documento fica visível publicamente

#### **Passo 5: Consulta Pública**

```bash
GET /documento/filtrado
```

**Retorna:**
```json
[
  {
    "id": 1,
    "type": "PORTARIA",
    "url": "https://transparenciastoragepub.aracaju.se.gov.br/atos-normativos/PORTARIA/PORTARIA_123_2024.pdf",
    "number": "123/2024",
    "title": "PORTARIA 123/2024",
    "date": "2024-03-15",
    "description": "Dispõe sobre a realização...",
    "atualizado_em": "2024-03-15T10:30:00Z"
  }
]
```

---

## ⚙️ Setup e Instalação

### 1. **Pré-requisitos**

```bash
# Sistema
- Node.js 18+ (recomendado v20)
- Docker & Docker Compose
- pdftoppm (para conversão PDF → Imagem)

# Windows (via Chocolatey ou WSL)
choco install poppler-data

# macOS (via Homebrew)
brew install poppler

# Linux (via apt)
sudo apt-get install poppler-utils
```

### 2. **Clonar Repositório**

```bash
git clone <repositorio>
cd api_documentos
```

### 3. **Instalar Dependências**

```bash
npm install
```

### 4. **Configurar Variáveis de Ambiente**

Criar arquivo `.env` na raiz:

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=usuario
DB_PASSWORD=senha123
DB_DATABASE=pma

# Redis (BullMQ)
REDIS_HOST=localhost
REDIS_PORT=6379

# MinIO
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=admin
MINIO_SECRET_KEY=password
MINIO_BUCKET=atos-normativos

# URL Pública (para formatação de links)
PUBLIC_URL=https://transparenciastoragepub.aracaju.se.gov.br

# NestJS
NODE_ENV=development
PORT=3001
```

### 5. **Subir Containers (Docker Compose)**

```bash
docker-compose up -d
```

Serviços que sobem:
- **PostgreSQL** (porta 5432)
- **Redis** (porta 6379)
- **MinIO** (portas 9000, 9001)

Verificar status:
```bash
docker-compose ps
docker-compose logs -f
```

### 6. **Iniciar API**

```bash
# Desenvolvimento (com watch)
npm run start:dev

# Produção
npm run build
npm run start:prod
```

A API estará disponível em `http://localhost:3001`

### 7. **Verificar MinIO**

Console web: `http://localhost:9001`
- User: `admin`
- Password: `password`

---

## 📡 Exemplos de Requisições

### Fazer Upload de Documento

**Etapa 1: Upload Temporário**
```bash
curl -X POST http://localhost:3001/files/upload-temporary-pdf \
  -F "file=@/caminho/portaria.pdf"
```

**Resposta:**
```json
{
  "message": "Arquivo enviado temporariamente.",
  "tempFilename": "1609459200000-portaria.pdf"
}
```

**Etapa 2: Finalizar Upload**
```bash
curl -X POST http://localhost:3001/files/finalize-upload \
  -H "Content-Type: application/json" \
  -d '{
    "tempFilename": "1609459200000-portaria.pdf",
    "finalFilename": "PORTARIA/portaria_123",
    "documentoId": "1",
    "docType": "PORTARIA"
  }'
```

### Aprovar Documento

```bash
curl -X PATCH http://localhost:3001/documento/1/aprovar \
  -H "Content-Type: application/json" \
  -d '{
    "number": "123/2024",
    "title": "PORTARIA 123/2024",
    "date": "2024-03-15",
    "description": "Dispõe sobre..."
  }'
```

### Buscar Documentos

```bash
# Todos
curl http://localhost:3001/documento

# Apenas aprovados (sem fullText - para público)
curl http://localhost:3001/documento/filtrado

# Um específico
curl http://localhost:3001/documento/1

# Por número
curl http://localhost:3001/documento/numero/123/2024
```

### Download de PDF

```bash
curl -X GET http://localhost:3001/documento/download/PORTARIA_123_2024.pdf \
  -o portaria_123_2024.pdf
```

---

## 🔥 Rotas de Manutenção/Emergência

### Migração em Massa (Reprocessar Documentos sem Texto)

```bash
curl -X GET http://localhost:3001/documento/fix/migracao-geral
```

**O que faz:**
- Identifica todos os documentos com `fullText IS NULL`
- Enfileira cada um na fila OCR
- Gera log `migracao_falhas.log` com erros
- Sanitiza OCR (remove caracteres especiais)

### Padronizar Nomes de Arquivos

```bash
curl -X GET http://localhost:3001/documento/fix/padronizar-todos
```

**O que faz:**
- Renomeia arquivos no MinIO para padrão: `TIPO_NUMERO_ANO.pdf`
- Atualiza URLs no banco de dados

### Atualizar Ementas

```bash
curl -X GET http://localhost:3001/documento/fix/atualizar-ementas
```

**O que faz:**
- Reaplica limpeza de ementas em documentos já processados
- Remove caracteres inválidos

---

## 🧪 Testes

```bash
# Unit Tests
npm run test

# Com cobertura
npm run test:cov

# E2E Tests
npm run test:e2e

# Watch mode
npm run test:watch
```

---

## 🔐 Segurança e Boas Práticas

1. **Trava de Segurança (Lock)**
   - OCR Processor usa `concurrency: 1` para evitar race conditions
   - `lockDuration: 300000` previne travamento indefinido

2. **Proteção de Dados**
   - Arquivos temporários deletados após sucesso
   - URLs formatadas para domínio público
   - Validação via class-validator nos DTOs

3. **Retry Automático**
   - BullMQ reaplica jobs com falha
   - Erros salvos em `mensagem_erro` para auditoria

4. **Limite de Upload**
   - `bodyParser: 1000mb` para PDFs grandes
   - Proteção contra DDoS via CORS

---

## 📊 Monitoramento

### Status da Fila

Acessar console Redis:
```bash
docker exec -it redis_queue redis-cli
> KEYS *
> HGETALL bull:ocr-queue:*
```

### Logs da API

```bash
# Logs gerais
docker-compose logs api -f

# Apenas erros
docker-compose logs api -f | grep ERROR
```

### Verificar Banco de Dados

```bash
docker exec -it postgres_db psql -U usuario -d pma

# Dentro do psql
SELECT id, status_ocr, aprovado, mensagem_erro FROM documento LIMIT 10;
```

---

## 🐛 Troubleshooting

### Erro: `pdftoppm not found`

**Solução:**
```bash
# Windows (WSL)
wsl apt-get install poppler-utils

# macOS
brew install poppler

# Linux
sudo apt-get install poppler-utils
```

### Erro: `MINIO_BUCKET not found`

**Solução:**
- Verificar `.env` e docker-compose
- MinIO cria bucket automaticamente no `onModuleInit`
- Se não criou, acessar console `http://localhost:9001` e criar manualmente

### Erro: `Documento ID não encontrado`

**Solução:**
- Verificar se documento foi criado em PENDENTE antes de aprovar
- Verificar logs do OcrProcessor (`npm run start:dev`)

### OCR extraindo texto incorreto

**Possíveis causas:**
- PDF com imagem de baixa qualidade (aumentar DPI em `pdftoppm`)
- Idioma diferente (verificar padrão regex)
- Caracteres especiais não reconhecidos (ajustar limpeza)

---

## 📝 Desenvolvimento e Deploy

### Scripts Disponíveis

```bash
npm run start        # Modo produção
npm run start:dev    # Modo desenvolvimento (com watch)
npm run start:debug  # Modo debug com breakpoints
npm run build        # Build para produção
npm run lint         # Verificar código com ESLint
npm run format       # Formatar código com Prettier
npm run test         # Executar testes
```

### Variáveis de Ambiente por Ambiente

**Development (.env.development):**
```
NODE_ENV=development
DB_HOST=localhost
LOG_LEVEL=debug
```

**Production (.env.production):**
```
NODE_ENV=production
DB_HOST=prod-db-server.com
LOG_LEVEL=error
```

---

## 📚 Dependências Principais

| Dependência | Versão | Propósito |
|-------------|--------|----------|
| `@nestjs/core` | ^11.1.2 | Framework principal |
| `@nestjs/typeorm` | ^11.0.0 | ORM para banco de dados |
| `typeorm` | ^0.3.24 | Manipulação de entidades |
| `@nestjs/bullmq` | ^11.0.4 | Filas de processamento |
| `bullmq` | ^5.70.4 | Worker de filas |
| `ioredis` | ^5.10.0 | Cliente Redis |
| `tesseract.js` | ^6.0.1 | OCR |
| `@aws-sdk/client-s3` | ^3.890.0 | Cliente MinIO/S3 |
| `pg` | ^8.16.0 | Driver PostgreSQL |
| `express` | ^5.1.0 | Servidor HTTP |
| `multer` | ^2.0.2 | Upload de arquivos |

---

## 🤝 Contribuindo

1. Criar branch: `git checkout -b feature/minha-feature`
2. Commit: `git commit -m 'Add: Minha feature'`
3. Push: `git push origin feature/minha-feature`
4. Pull Request

---

## 📜 Licença

UNLICENSED - Projeto privado

---

## ✉️ Contato

Para dúvidas ou issues, abra uma issue no repositório ou entre em contato com a equipe de desenvolvimento.
