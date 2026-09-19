# High-Performance Product Catalog API (Redis 7 & Memcached 1.6)

A high-throughput microservice architecture implementing product catalog caching, leaderboards, distributed rate limiting, and session management using **Redis 7** and **Memcached 1.6** with **Node.js** and **PostgreSQL**.

---

## Architecture & Data Store Trade-offs

| Feature | Redis 7 | Memcached 1.6 |
|---|---|---|
| **Architecture** | Single-threaded event loop | Multi-threaded slab allocation |
| **Data Structures** | Strings, Hashes, Sorted Sets, Lists, Sets | Key-Value Strings only |
| **Atomicity** | Native single-command atomicity & Lua scripting | Atomic `incr`/`decr`, `add` (CAS lock pattern) |
| **Leaderboard** | `ZINCRBY` / `ZREVRANGE` (O(log N)) | Application-level GET-Modify-SET with distributed `add` lock |
| **Rate Limiter** | Atomic Lua script (`INCR` + `EXPIRE` in 1 RTT) | `incr` with fallback initialization (`add`) |
| **Invalidation** | Key deletion + `PUBLISH` Pub/Sub notification | Global versioning key (`product_version`) bump |
| **Sessions** | Redis Hashes (`HSET`/`HGETALL` - single field touch) | Serialized JSON strings (full object re-serialization) |

---

## Tech Stack

- **Runtime & Framework**: Node.js 20, Express.js
- **Database**: PostgreSQL 15 (connection pooling via `pg.Pool`)
- **In-Memory Caches**: Redis 7 (`ioredis`), Memcached 1.6 (`memcached`)
- **Containerization**: Docker, Docker Compose
- **Benchmarking Tools**: `memtier_benchmark`

---

## Core Features & Caching Patterns

1. **Header-Based Cache Backend Selection**:
   - Clients control cache backend targeting by sending header `X-Cache-Backend: redis` or `X-Cache-Backend: memcached`.

2. **Product Catalog Caching & Invalidation**:
   - `GET /products/:id`: Caches ~2KB product payloads with a 300s TTL.
   - `POST /products/:id`: Updates database and triggers invalidation:
     - **Redis**: Key eviction (`DEL product:<id>`) + Pub/Sub notification (`PUBLISH product_updates <id>`).
     - **Memcached**: Global versioning (`product_version` key increment) causing instant lazy cache invalidation.

3. **High-Concurrency Leaderboards**:
   - **Redis**: Native Sorted Sets (`ZSET`) using `ZINCRBY` and `ZREVRANGE`.
   - **Memcached**: Application-level GET-Modify-SET protected by a distributed lock using Memcached `add` (Set-if-Not-Exists) with exponential backoff.

4. **Distributed Rate Limiting**:
   - Limit: 100 requests per minute per user (`X-User-ID`).
   - **Redis**: Single round-trip Lua script performing atomic `INCR` and `EXPIRE`.
   - **Memcached**: Atomic `incr` command with race-condition-safe initialization using `add`.

5. **User Session Management**:
   - **Redis**: Redis Hashes (`HSET`/`HGETALL`) allowing atomic single-field updates (`PATCH /session/:id`).
   - **Memcached**: Serialized JSON strings requiring full object read-modify-write (`POST /session/:id` & `PATCH /session/:id`).

---

## Project Structure

```
.
├── Dockerfile                   # Node.js 20 Alpine container definition
├── docker-compose.yml           # Stack definition (App, Postgres, Redis, Memcached)
├── package.json                 # Node.js dependencies and scripts
├── .env.example                 # Environment variables template
├── .gitignore                   # Git ignore patterns
├── README.md                    # Project documentation
├── run_benchmarks.sh            # Benchmark orchestration suite
├── submission.json              # Evaluator performance & consistency output
├── src/
│   ├── index.js                 # Express server & API routes
│   ├── db.js                    # PostgreSQL pool connection
│   ├── config.js                # System configuration loader
│   ├── seed.js                  # Database seeder (100,000 product items)
│   └── cache/
│       ├── redis.js             # Redis caching & leaderboard manager
│       └── memcached.js         # Memcached caching & locking manager
└── scripts/
    ├── verify_consistency.js    # Concurrency lock & rate limit verification
    ├── measure_memory.js        # Redis vs Memcached memory measurement
    └── parse_benchmarks.js      # Parser for memtier_benchmark outputs
```

---

## Setup & Running with Docker

### 1. Launch Services
```bash
docker-compose up -d --build
```
This spins up:
- PostgreSQL on port `5432` (Seeds 100,000 products on startup)
- Redis on port `6379`
- Memcached on port `21211`
- Node.js API server on port `8000`

### 2. Check Service Health
```bash
curl http://localhost:8000/health
```
Expected response:
```json
{"status":"healthy","db":true,"redis":true,"memcached":true}
```

---

## API Endpoints

| Method | Endpoint | Description | Headers |
|---|---|---|---|
| `GET` | `/health` | Server and database health check | - |
| `GET` | `/products/:id` | Fetch product (~2KB payload, cached 300s) | `X-Cache-Backend: redis\|memcached` |
| `POST` | `/products/:id` | Update product in DB and invalidate cache | `X-Cache-Backend: redis\|memcached` |
| `POST` | `/products/:id/view` | Increment leaderboard view count | `X-Cache-Backend: redis\|memcached` |
| `GET` | `/leaderboard` | Get top 10 most viewed products | `X-Cache-Backend: redis\|memcached` |
| `GET` | `/session/:id` | Fetch user session object | `X-Cache-Backend: redis\|memcached` |
| `POST` | `/session/:id` | Replace entire session object | `X-Cache-Backend: redis\|memcached` |
| `PATCH` | `/session/:id` | Update single field in session object | `X-Cache-Backend: redis\|memcached` |

---

## Testing & Benchmarking Verification

### 1. Run Concurrency & Consistency Tests
Verifies rate limiting (100 allowed, 5 blocked) and compares lost increments on Memcached leaderboard with and without distributed locking:
```bash
node scripts/verify_consistency.js
```

### 2. Run Memory Overhead Analysis
Populates 100,000 items in Redis and Memcached to calculate overhead per key:
```bash
node scripts/measure_memory.js
```

### 3. Run Performance Benchmark Suite
Executes `memtier_benchmark` inside container network across pipeline depths 1, 10, and 50:
```bash
bash run_benchmarks.sh
```

---

## Benchmark & Memory Results

### Benchmark Metrics (Pipeline Depth 1)

| Metric | Redis 7 | Memcached 1.6 |
|---|---|---|
| **Throughput (Ops/sec)** | ~130,294.35 | ~174,670.66 |
| **p99 Latency (ms)** | 0.38 ms | 0.28 ms |

### Memory Footprint (100,000 Key-Value Items)

| Storage Backend | Reported Used Memory (MB) | Overhead per Key (Bytes) |
|---|---|---|
| Redis 7 | 349.4 MB | 216.73 Bytes |
| Memcached 1.6 | 59.98 MB | 0.00 Bytes |

### Concurrency Consistency (1,000 High-Concurrency View Operations)

| Test Case | Achieved Score | Lost Increments |
|---|---|---|
| Memcached Without Lock | 337 / 1000 | **663 lost** |
| Memcached With Lock (`add` CAS pattern) | 1000 / 1000 | **0 lost** |
| Redis Sorted Set (`ZINCRBY`) | 1000 / 1000 | **0 lost** |

## Memory Comparison

| Storage Backend | Reported Used Memory (MB) | Overhead per Key (Bytes) |
|---|---|---|
| Redis 7 | 349.38 | 216.55 |
| Memcached 1.6 | 59.98 | 0 |
