const { pool } = require('./db');

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    category VARCHAR(100) NOT NULL,
    inventory INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

const PADDING_TEXT = (
    "High performance specifications and features. " +
    "Designed for enterprise scale workloads with low-latency in-memory caching support. " +
    "Features include automatic failover, real-time leaderboard sorting, atomic operations, " +
    "and high-throughput multi-threaded access capability. "
).repeat(12);

const CATEGORIES = ["Electronics", "Computers", "Home & Kitchen", "Books", "Clothing", "Sports", "Automotive", "Toys"];

async function seedProducts(targetCount = 100000) {
    const client = await pool.connect();
    try {
        await client.query(CREATE_TABLE_SQL);
        const res = await client.query('SELECT COUNT(*) FROM products;');
        const currentCount = parseInt(res.rows[0].count, 10);

        console.log(`Current product count in database: ${currentCount}`);

        if (currentCount >= targetCount) {
            console.log(`Target count of ${targetCount} already satisfied. Skipping seeding.`);
            return;
        }

        const needed = targetCount - currentCount;
        console.log(`Seeding ${needed} product records into database...`);

        const batchSize = 2500;
        const startId = currentCount + 1;

        for (let batchStart = 0; batchStart < needed; batchStart += batchSize) {
            const batchCount = Math.min(batchSize, needed - batchStart);
            const valueRows = [];
            const queryParams = [];

            let paramIdx = 1;
            for (let i = 0; i < batchCount; i++) {
                const idx = startId + batchStart + i;
                const name = `Product Item #${idx}`;
                const category = CATEGORIES[idx % CATEGORIES.length];
                const price = (10.0 + (idx % 990) + (idx % 100) / 100.0).toFixed(2);
                const inventory = (idx * 7) % 500;
                const desc = `Product #${idx} - ${category}. ${PADDING_TEXT}`;

                valueRows.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4})`);
                queryParams.push(name, desc, price, category, inventory);
                paramIdx += 5;
            }

            const insertSql = `
        INSERT INTO products (name, description, price, category, inventory)
        VALUES ${valueRows.join(', ')}
      `;
            await client.query(insertSql, queryParams);
            console.log(`Inserted batch ${Math.floor(batchStart / batchSize) + 1}/${Math.ceil(needed / batchSize)} (${batchStart + batchCount}/${needed})`);
        }

        const finalRes = await client.query('SELECT COUNT(*) FROM products;');
        console.log(`Seeding complete. Total product count: ${finalRes.rows[0].count}`);
    } catch (err) {
        console.error('Error during seeding:', err);
        throw err;
    } finally {
        client.release();
    }
}

if (require.main === module) {
    seedProducts()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });
}

module.exports = { seedProducts };
