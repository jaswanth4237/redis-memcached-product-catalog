const fs = require('fs');

function parseMemtierOutput(filePath) {
    if (!fs.existsSync(filePath)) {
        return { ops: 0.0, p99: 0.0 };
    }

    const content = fs.readFileSync(filePath, 'utf8');

    // Split file by pipeline sections
    const sections = content.split('--- Pipeline Depth:');
    let opsP1 = 0.0;
    let p99P1 = 0.0;

    for (const sec of sections) {
        if (sec.trim().startsWith('1')) {
            // This section is for Pipeline Depth 1
            const totalsLine = sec.match(/Totals\s+([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)/);
            if (totalsLine) {
                opsP1 = parseFloat(totalsLine[1]); // Ops/sec
                p99P1 = parseFloat(totalsLine[6]); // p99 Latency in msec
            }
            break;
        }
    }

    return { ops: opsP1, p99: p99P1 };
}

function updateSubmissionBenchmarks() {
    const redisFile = 'results/redis_bench.txt';
    const memcachedFile = 'results/memcached_bench.txt';

    const redisRes = parseMemtierOutput(redisFile);
    const mcRes = parseMemtierOutput(memcachedFile);

    const subFile = 'submission.json';
    let data = {};
    if (fs.existsSync(subFile)) {
        try {
            data = JSON.parse(fs.readFileSync(subFile, 'utf8'));
        } catch (e) { }
    }

    if (!data.benchmarks) data.benchmarks = {};

    data.benchmarks.redis_ops_p1 = parseFloat(redisRes.ops.toFixed(2));
    data.benchmarks.memcached_ops_p1 = parseFloat(mcRes.ops.toFixed(2));
    data.benchmarks.redis_p99_ms = parseFloat(redisRes.p99.toFixed(2));
    data.benchmarks.memcached_p99_ms = parseFloat(mcRes.p99.toFixed(2));

    fs.writeFileSync(subFile, JSON.stringify(data, null, 2));
    console.log(`Updated ${subFile} with benchmarks:`, JSON.stringify(data.benchmarks, null, 2));
}

if (require.main === module) {
    updateSubmissionBenchmarks();
}

module.exports = { updateSubmissionBenchmarks };
