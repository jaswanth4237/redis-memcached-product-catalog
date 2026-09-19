const fs = require('fs');
const Redis = require('ioredis');
const Memcached = require('memcached');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/0';
const MEMCACHED_URL = process.env.MEMCACHED_URL || 'localhost:21211';

const SAMPLE_PAYLOAD = JSON.stringify({
    id: 1,
    name: "Sample Product for Memory Benchmark",
    description: "High performance specifications and features. Designed for enterprise scale workloads with low-latency in-memory caching support. Features include automatic failover, real-time leaderboard sorting, atomic operations, and high-throughput multi-threaded access capability. ".repeat(12),
    price: 99.99,
    category: "Electronics",
    inventory: 100,
    created_at: "2026-09-19T11:00:00",
    updated_at: "2026-09-19T11:00:00"
});

const RAW_PAYLOAD_SIZE = Buffer.byteLength(SAMPLE_PAYLOAD, 'utf8');

async function measureRedis() {
    const redis = new Redis(REDIS_URL);
    console.log("Populating 100,000 keys into Redis...");
    await redis.flushdb();

    let pipeline = redis.pipeline();
    for (let i = 1; i <= 100000; i++) {
        pipeline.set(`product:${i}`, SAMPLE_PAYLOAD);
        if (i % 10000 === 0) {
            await pipeline.exec();
            pipeline = redis.pipeline();
            console.log(`Redis populated ${i}/100000`);
        }
    }

    const infoRaw = await redis.info('memory');
    const match = infoRaw.match(/used_memory:(\d+)/);
    const usedMemoryBytes = match ? parseInt(match[1], 10) : 0;
    const usedMemoryMb = parseFloat((usedMemoryBytes / (1024 * 1024)).toFixed(2));
    const avgBytesPerKey = usedMemoryBytes / 100000;
    const overheadPerKey = parseFloat(Math.max(0, avgBytesPerKey - RAW_PAYLOAD_SIZE).toFixed(2));

    console.log(`Redis Used Memory: ${usedMemoryMb} MB, Overhead per key: ${overheadPerKey} Bytes`);
    redis.disconnect();
    return { mb: usedMemoryMb, overhead: overheadPerKey };
}

async function measureMemcached() {
    const mc = new Memcached(MEMCACHED_URL);
    console.log("Populating 100,000 keys into Memcached...");

    await new Promise((resolve) => mc.flush(() => resolve()));

    for (let i = 1; i <= 100000; i++) {
        await new Promise((resolve) => mc.set(`v1:product:${i}`, SAMPLE_PAYLOAD, 0, () => resolve()));
        if (i % 10000 === 0) {
            console.log(`Memcached populated ${i}/100000`);
        }
    }

    const stats = await new Promise((resolve) => {
        mc.stats((err, results) => {
            if (err || !results || results.length === 0) return resolve({});
            resolve(results[0]);
        });
    });

    const bytesUsed = stats.bytes ? parseInt(stats.bytes, 10) : 0;
    const usedMemoryMb = parseFloat((bytesUsed / (1024 * 1024)).toFixed(2));
    const avgBytesPerKey = bytesUsed / 100000;
    const overheadPerKey = parseFloat(Math.max(0, avgBytesPerKey - RAW_PAYLOAD_SIZE).toFixed(2));

    console.log(`Memcached Used Memory: ${usedMemoryMb} MB, Overhead per key: ${overheadPerKey} Bytes`);
    mc.end();
    return { mb: usedMemoryMb, overhead: overheadPerKey };
}

function updateReadme(redisRes, mcRes) {
    const tableMd = `## Memory Comparison

| Storage Backend | Reported Used Memory (MB) | Overhead per Key (Bytes) |
|---|---|---|
| Redis 7 | ${redisRes.mb} | ${redisRes.overhead} |
| Memcached 1.6 | ${mcRes.mb} | ${mcRes.overhead} |
`;

    const readmePath = 'README.md';
    let content = '';
    if (fs.existsSync(readmePath)) {
        content = fs.readFileSync(readmePath, 'utf8');
    }

    let newContent = '';
    if (content.includes('## Memory Comparison')) {
        const parts = content.split('## Memory Comparison');
        newContent = parts[0] + tableMd;
    } else {
        newContent = content + '\n' + tableMd;
    }

    fs.writeFileSync(readmePath, newContent);
    console.log(`Updated ${readmePath} with memory comparison table.`);
}

async function main() {
    const redisRes = await measureRedis();
    const mcRes = await measureMemcached();
    updateReadme(redisRes, mcRes);
}

main().catch((err) => {
    console.error('Memory measurement error:', err);
    process.exit(1);
});
