# Local Development Setup

## Prerequisites
- Docker Desktop
- Node.js 20+
- npm 10+

## First-time Setup

### 1. Clone and install
```bash
git clone <repo-url>
cd welfare-system
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env and fill in required values (see .env.example comments)
```

### 3. Add local DNS entries
Add to your hosts file:

**Windows** (`C:\Windows\System32\drivers\etc\hosts`):
```
127.0.0.1 welfare.local
127.0.0.1 api.welfare.local
127.0.0.1 minio.welfare.local
```

**macOS/Linux** (`/etc/hosts`):
```
127.0.0.1 welfare.local
127.0.0.1 api.welfare.local
127.0.0.1 minio.welfare.local
```

### 4. Start services
```bash
docker compose up -d
```

### 5. Access
| URL | Service |
|-----|---------|
| https://welfare.local | Web app |
| https://api.welfare.local/health | API health check |
| https://minio.welfare.local | MinIO console |

## Development (without Docker for app services)

Run infrastructure only:
```bash
docker compose up -d mongodb redis minio minio-init meilisearch
```

Then run app services locally:
```bash
npm run dev
```

## Ports (direct access, bypassing Caddy)
| Service | Port |
|---------|------|
| NestJS API | http://localhost:4000 |
| Next.js Web | http://localhost:3000 |
| MongoDB | localhost:27017 |
| Redis | localhost:6379 |
| MinIO API | http://localhost:9000 |
| MinIO Console | http://localhost:9001 |
| Meilisearch | http://localhost:7700 |
