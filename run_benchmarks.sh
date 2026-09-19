#!/bin/bash
set -e

mkdir -p results

echo "Starting Memtier Benchmarks..."
echo "==================================================" > results/redis_bench.txt
echo "Redis Benchmark Results" >> results/redis_bench.txt
echo "==================================================" >> results/redis_bench.txt

echo "==================================================" > results/memcached_bench.txt
echo "Memcached Benchmark Results" >> results/memcached_bench.txt
echo "==================================================" >> results/memcached_bench.txt

NETWORK_NAME="redis-memcached-product-catalog_default"
REDIS_HOST="redis"
MEMCACHED_HOST="memcached"

PIPELINES=(1 10 50)

for P in "${PIPELINES[@]}"; do
    echo "Benchmarking Redis - Pipeline Depth: $P"
    echo "--- Pipeline Depth: $P ---" >> results/redis_bench.txt
    docker run --rm --network $NETWORK_NAME redislabs/memtier_benchmark \
        --server=$REDIS_HOST \
        --port=6379 \
        --protocol=redis \
        --ratio=9:1 \
        --key-pattern=G:G \
        --pipeline=$P \
        --requests=5000 \
        --clients=10 \
        --threads=2 >> results/redis_bench.txt 2>&1 || true
    echo "" >> results/redis_bench.txt
done

for P in "${PIPELINES[@]}"; do
    echo "Benchmarking Memcached - Pipeline Depth: $P"
    echo "--- Pipeline Depth: $P ---" >> results/memcached_bench.txt
    docker run --rm --network $NETWORK_NAME redislabs/memtier_benchmark \
        --server=$MEMCACHED_HOST \
        --port=11211 \
        --protocol=memcache_text \
        --ratio=9:1 \
        --key-pattern=G:G \
        --pipeline=$P \
        --requests=5000 \
        --clients=10 \
        --threads=2 >> results/memcached_bench.txt 2>&1 || true
    echo "" >> results/memcached_bench.txt
done

echo "Parsing benchmark results and updating submission.json..."
node scripts/parse_benchmarks.js || node.exe scripts/parse_benchmarks.js || powershell -Command "node scripts/parse_benchmarks.js"

echo "Benchmark suite completed successfully!"
