const fs = require('fs');
const http = require('http');

const BASE_URL = process.env.API_URL || 'http://localhost:8000';

function makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    resolve({ statusCode: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : {} });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
                }
            });
        });
        req.on('error', reject);
        if (options.body) {
            req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
        }
        req.end();
    });
}

async function testMemcachedLeaderboardNoLock(productId) {
    const worker = async (workerId, count = 100) => {
        for (let i = 0; i < count; i++) {
            try {
                await makeRequest(`${BASE_URL}/products/${productId}/view?use_lock=false`, {
                    method: 'POST',
                    headers: {
                        'X-Cache-Backend': 'memcached',
                        'X-User-ID': `nolock_usr_${workerId}_${i}`,
                    },
                });
            } catch (e) { }
        }
    };

    const tasks = Array(10).fill(0).map((_, idx) => worker(idx, 100));
    await Promise.all(tasks);

    const getRes = await makeRequest(`${BASE_URL}/leaderboard`, {
        method: 'GET',
        headers: { 'X-Cache-Backend': 'memcached', 'X-User-ID': 'leaderboard_fetcher' },
    });

    const lb = getRes.body.leaderboard || [];
    let achieved = 0;
    for (const item of lb) {
        if (String(item.product_id) === String(productId)) {
            achieved = item.views;
            break;
        }
    }

    const expected = 1000;
    const lost = expected - achieved;
    console.log(`[No Lock] Target: ${expected}, Achieved: ${achieved}, Lost Increments: ${lost}`);
    return Math.max(0, lost);
}

async function testMemcachedLeaderboardWithLock(productId) {
    const worker = async (workerId, count = 100) => {
        for (let i = 0; i < count; i++) {
            try {
                await makeRequest(`${BASE_URL}/products/${productId}/view?use_lock=true`, {
                    method: 'POST',
                    headers: {
                        'X-Cache-Backend': 'memcached',
                        'X-User-ID': `withlock_usr_${workerId}_${i}`,
                    },
                });
            } catch (e) { }
        }
    };

    const tasks = Array(10).fill(0).map((_, idx) => worker(idx, 100));
    await Promise.all(tasks);

    const getRes = await makeRequest(`${BASE_URL}/leaderboard`, {
        method: 'GET',
        headers: { 'X-Cache-Backend': 'memcached', 'X-User-ID': 'leaderboard_fetcher' },
    });

    const lb = getRes.body.leaderboard || [];
    let achieved = 0;
    for (const item of lb) {
        if (String(item.product_id) === String(productId)) {
            achieved = item.views;
            break;
        }
    }

    const expected = 1000;
    const lost = expected - achieved;
    console.log(`[With Lock] Target: ${expected}, Achieved: ${achieved}, Lost Increments: ${lost}`);
    return lost;
}

async function testRedisLeaderboard(productId) {
    const worker = async (workerId, count = 100) => {
        for (let i = 0; i < count; i++) {
            try {
                await makeRequest(`${BASE_URL}/products/${productId}/view`, {
                    method: 'POST',
                    headers: {
                        'X-Cache-Backend': 'redis',
                        'X-User-ID': `redis_usr_${workerId}_${i}`,
                    },
                });
            } catch (e) { }
        }
    };

    const tasks = Array(10).fill(0).map((_, idx) => worker(idx, 100));
    await Promise.all(tasks);

    const getRes = await makeRequest(`${BASE_URL}/leaderboard`, {
        method: 'GET',
        headers: { 'X-Cache-Backend': 'redis', 'X-User-ID': 'leaderboard_fetcher' },
    });

    const lb = getRes.body.leaderboard || [];
    let achieved = 0;
    for (const item of lb) {
        if (String(item.product_id) === String(productId)) {
            achieved = item.views;
            break;
        }
    }

    const expected = 1000;
    console.log(`[Redis ZSET] Target: ${expected}, Achieved: ${achieved}`);
    return achieved;
}

async function testRateLimiter(backend = 'redis') {
    const userId = `test_rate_user_${backend}_${Date.now()}`;
    const options = {
        method: 'GET',
        headers: {
            'X-Cache-Backend': backend,
            'X-User-ID': userId,
        },
    };

    const responses = [];
    for (let i = 0; i < 105; i++) {
        const res = await makeRequest(`${BASE_URL}/products/1`, options);
        responses.push(res.statusCode);
    }

    const c200 = responses.filter((s) => s === 200).length;
    const c429 = responses.filter((s) => s === 429).length;

    console.log(`[Rate Limiter - ${backend}] 200 responses: ${c200}, 429 responses: ${c429}`);
    if (c200 !== 100 || c429 !== 5) {
        throw new Error(`Rate limiter assertion failed: expected 100 HTTP 200 and 5 HTTP 429, got 200:${c200}, 429:${c429}`);
    }
}

async function main() {
    const health = await makeRequest(`${BASE_URL}/health`, { method: 'GET' });
    console.log(`Health check status: ${health.statusCode}, body:`, health.body);

    console.log('\n--- Testing Rate Limiter (Redis) ---');
    await testRateLimiter('redis');

    console.log('\n--- Testing Rate Limiter (Memcached) ---');
    await testRateLimiter('memcached');

    const randSuffix = Math.floor(Math.random() * 900) + 100;
    const noLockProductId = 9000 + randSuffix;
    const withLockProductId = 8000 + randSuffix;
    const redisProductId = 7000 + randSuffix;

    console.log('\n--- Race Condition Test: Memcached Leaderboard WITHOUT Lock ---');
    const lostNoLock = await testMemcachedLeaderboardNoLock(noLockProductId);

    console.log('\n--- Race Condition Test: Memcached Leaderboard WITH Lock ---');
    const lostWithLock = await testMemcachedLeaderboardWithLock(withLockProductId);

    console.log('\n--- Race Condition Test: Redis Leaderboard ---');
    await testRedisLeaderboard(redisProductId);

    const subFile = 'submission.json';
    let data = {};
    if (fs.existsSync(subFile)) {
        try {
            data = JSON.parse(fs.readFileSync(subFile, 'utf8'));
        } catch (e) { }
    }

    if (!data.consistency) data.consistency = {};
    data.consistency.memcached_lost_increments_no_lock = lostNoLock;
    data.consistency.memcached_lost_increments_with_lock = Math.max(0, lostWithLock);

    fs.writeFileSync(subFile, JSON.stringify(data, null, 2));
    console.log(`\nSuccessfully updated ${subFile} with consistency results.`);
}

main().catch((err) => {
    console.error('Verification script error:', err);
    process.exit(1);
});
