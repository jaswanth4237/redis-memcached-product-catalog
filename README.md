# High-Performance Product Catalog API (Redis 7 & Memcached 1.6)

A microservice architecture implementing product catalog caching, leaderboards, distributed rate limiting, and session management using **Redis 7** and **Memcached 1.6** with **Node.js**.

---

## Architectural Comparison

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

## Setup & Execution

### 1. Build and Run Stack
```bash
docker-compose up -d
```

### 2. Verify Health Status
```bash
curl http://localhost:8000/health
```

### 3. Run Benchmark Suite
```bash
bash run_benchmarks.sh
```

### 4. Run Consistency Verification
```bash
node scripts/verify_consistency.js
```

### 5. Measure Memory Overhead
```bash
node scripts/measure_memory.js
```

---

## API Endpoints

- `GET /products/:id`: Fetch product (~2KB JSON). Caches on first hit with 300s TTL. Header `X-Cache-Backend`: `redis` or `memcached`.
- `POST /products/:id`: Updates product in DB and invalidates active cache.
- `GET /leaderboard`: Returns top 10 most viewed product IDs.
- `POST /products/:id/view`: Increments view count for the leaderboard.
- `GET /session/:id`: Get session fields.
- `POST /session/:id`: Replace session object.
- `PATCH /session/:id`: Single-field update for session object.

---

## Memory Comparison

| Storage Backend | Reported Used Memory (MB) | Overhead per Key (Bytes) |
|---|---|---|
| Redis 7 | 349.4 | 216.73 |
| Memcached 1.6 | 59.98 | 0 |
