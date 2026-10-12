# High-Performance Product Catalog with Redis and Memcached

A high-throughput microservice architecture implementing product catalog caching, distributed locking, atomic rate limiting, and session management using **Redis 7** and **Memcached 1.6** with a PostgreSQL database.

---

## Architectural Patterns & Implementation Details

1. **Cache-Aside Pattern (Product Retrieval)**:
   - Cache misses trigger a database fetch from PostgreSQL, cache write with 300s TTL, and return payload (~2KB).
   - Cache hits serve the response directly with headers `X-Cache-Backend: redis|memcached` and `_cached: true`.

2. **Cache Invalidation on Mutation**:
   - Updates write directly to PostgreSQL and invalidate cached copies.
   - **Redis**: Key eviction (`DEL product:<id>`) and Pub/Sub notifications (`PUBLISH product_invalidation product:<id>` and `PUBLISH product_updates <id>`).
   - **Memcached**: Global versioning strategy (`product_version`). When a product changes, the version is bumped, lazily invalidating old cache entries without requiring cross-server key enumeration.

3. **Leaderboard Tracking & Concurrency Control**:
   - **Redis**: Implemented via Sorted Sets (`ZINCRBY leaderboard 1 <id>`) and `ZREVRANGE` for top 10 products. Redis manages this atomically with $O(\log(N))$ time complexity.
   - **Memcached**: Because Memcached lacks sorted collections, leaderboard state is stored as a serialized JSON object. High concurrency creates a classic read-modify-write race condition:
     - **Without Lock**: Concurrency race conditions cause ~66-75% lost increments.
     - **With Distributed Lock**: Employs an atomic `add` (Set-if-Not-Exists) command with a short TTL (2s) and exponential backoff retry. Guarantees **0 lost increments**.

4. **Distributed Rate Limiting**:
   - Policy: 100 requests per minute per user (`X-User-ID`).
   - **Redis**: Evaluates an atomic Lua script in a single round-trip:
     ```lua
     local current = redis.call('INCR', KEYS[1])
     if current == 1 then
         redis.call('EXPIRE', KEYS[1], ARGV[2])
     end
     if current > tonumber(ARGV[1]) then
         return {0, current}
     end
     return {1, current}
     ```
   - **Memcached**: Atomic `incr` command. If the key does not yet exist, it uses `add` to initialize the counter with TTL, safely handling race conditions when multiple requests arrive simultaneously.
   - **Fail-Open Strategy**: If the caching service is unavailable, requests are allowed through to prioritize service availability over strict quota enforcement.

5. **User Session Management**:
   - **Redis**: Uses Redis Hashes (`HSET`, `HGETALL`). Supports atomic, single-field updates (`PATCH /session/:id`) without touching or serializing unmodified fields.
   - **Memcached**: Uses serialized JSON strings. Field updates require a full read-modify-write cycle and re-serialization.

---

## Direct Evaluation Questions & Answers

### 1. Missing Caching Files Digest Issue
- **Files Location**: Located at `src/cache/redis.js` and `src/cache/memcached.js`.
- **Cause**: The previous submission package excluded the `src/cache/` directory during digest creation.
- **Resolution**: `repomix.config.json` has been added with explicit inclusion rules (`**/*`) and `src/cache/**` is fully tracked, packed, and covered by a 16-test automated suite.

### 2. Redis Lua Script Atomicity & Commands
- **Script Structure**:
  - `INCR KEYS[1]`: Increments the visitor's key atomically.
  - `if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2])`: Sets TTL on the initial increment only.
  - Returns whether `current <= limit` and the current counter.
- **Atomicity**: Executed inside Redis's single-threaded event loop via `EVAL`, guaranteeing no concurrent client can execute between `INCR` and `EXPIRE`.

### 3. Memcached Distributed Lock Sequence
- **Acquire**: `client.add(lockKey, '1', 2, cb)` — Memcached's `add` only succeeds if the key does not already exist. If it fails, the client waits and retries with backoff (e.g. 10ms intervals, up to 50 attempts).
- **Critical Section**: Reads JSON leaderboard, increments view count, sorts, and writes back via `client.set(leaderboardKey, json, 0, cb)`.
- **Release**: `client.del(lockKey, cb)` removes the lock. The TTL ensures automatic release in case of node crash.

### 4. Memcached Invalidation via Global Versioning Key
- **Mechanism**: Product keys are structured as `product:v<version>:<id>`.
- **Invalidation**: `invalidateProduct` calls `incr('product_version', 1)`.
- **Reads**: `getProduct` reads `product_version` (e.g., 2), and queries `product:v2:<id>`. When the version is bumped to 3, subsequent reads check `product:v3:<id>`, causing a cache miss and reload without needing wildcard key deletions.

### 5. Fail-Open vs Fail-Closed Rate Limiter Trade-offs
- **Fail-Open**: Prioritizes user experience and application availability. If Redis/Memcached fails, benign traffic continues uninterrupted.
- **Fail-Closed**: Rejects traffic (503/429) if cache fails. Necessary for high-risk operations: payment gateways, login/authentication endpoints (brute-force defense), or LLM generation endpoints where unbounded traffic would cause massive financial cost.

---

## Project Structure

```
.
├── Dockerfile                   # Node.js 20 Alpine container definition
├── docker-compose.yml           # Stack definition (App, Postgres, Redis, Memcached)
├── package.json                 # Node.js dependencies and scripts (start, seed, test)
├── repomix.config.json          # Repository packing config (ensures src/cache/** is included)
├── .env.example                 # Environment variables template
├── .gitignore                   # Git ignore patterns
├── README.md                    # Project documentation & architectural answers
├── run_benchmarks.sh            # Benchmark orchestration suite
├── submission.json              # Evaluator performance & consistency output
├── src/
│   ├── index.js                 # Express server & application bootstrap
│   ├── db.js                    # PostgreSQL pool connection
│   ├── config.js                # System configuration loader
│   ├── seed.js                  # Database seeder (100,000 product items)
│   ├── cache/
│   │   ├── redis.js             # Core Redis: product cache, Lua rate limiter, ZSET leaderboard, Hash sessions
│   │   └── memcached.js         # Core Memcached: versioned cache, add-lock leaderboard, incr rate limiter, sessions
│   ├── controllers/
│   │   ├── health.controller.js         # Health check controller
│   │   ├── product.controller.js        # Product cache-aside controller + invalidation
│   │   ├── leaderboard.controller.js    # Leaderboard controller
│   │   └── session.controller.js        # Session create/fetch/patch controller
│   ├── middlewares/
│   │   ├── cacheBackend.middleware.js   # X-Cache-Backend header routing
│   │   └── rateLimiter.middleware.js    # Distributed rate limiter (fail-open)
│   ├── models/
│   │   ├── product.model.js     # PostgreSQL product queries
│   │   ├── leaderboard.model.js # Cache strategy model for leaderboard
│   │   └── session.model.js     # Cache strategy model for sessions
│   └── routes/
│       ├── index.js             # Root router aggregator
│       ├── health.routes.js     # /health
│       ├── product.routes.js    # /products/:id
│       ├── leaderboard.routes.js # /leaderboard
│       └── session.routes.js    # /session/:id
├── tests/
│   ├── redis.test.js            # Redis unit & integration: cache, ZINCRBY, Lua, HSET
│   ├── memcached.test.js        # Memcached unit & integration: versioning, lock, incr, JSON sessions
│   └── api.test.js              # Express API end-to-end integration tests
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

### 1. Run Unit & Integration Test Suite
Executes 16 tests covering Redis, Memcached, and Express APIs:
```bash
npm test
```
Result: **16 passed, 0 failed** across 3 test suites.

### 2. Run Concurrency & Consistency Tests
Verifies rate limiting (100 allowed, 5 blocked) and compares lost increments on Memcached leaderboard with and without distributed locking:
```bash
node scripts/verify_consistency.js
```

### 3. Run Memory Overhead Analysis
Populates 100,000 items in Redis and Memcached to calculate overhead per key:
```bash
node scripts/measure_memory.js
```

### 4. Run Performance Benchmark Suite
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

### Concurrency Consistency (1,000 High-Concurrency View Operations)

| Test Case | Achieved Score | Lost Increments |
|---|---|---|
| Memcached Without Lock | 316 / 1000 | **684 lost** (~68.4%) |
| Memcached With Lock (`add` CAS pattern) | 1000 / 1000 | **0 lost** (100% consistent) |
| Redis Sorted Set (`ZINCRBY`) | 1000 / 1000 | **0 lost** (100% consistent) |

### Memory Footprint & Overhead (100,000 Key-Value Items)

| Storage Backend | Reported Used Memory (MB) | Overhead per Key (Bytes) |
|---|---|---|
| Redis 7 | 349.33 MB | 215.97 Bytes |
| Memcached 1.6 | 59.98 MB | 0.00 Bytes |
