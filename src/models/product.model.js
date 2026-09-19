const db = require('../db');

class ProductModel {
    static async findById(id) {
        const result = await db.query('SELECT * FROM products WHERE id = $1', [id]);
        return result.rows[0] || null;
    }

    static async update(id, { name, description, price, category, inventory }) {
        const result = await db.query(
            `UPDATE products 
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           price = COALESCE($3, price),
           category = COALESCE($4, category),
           inventory = COALESCE($5, inventory),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING *`,
            [name, description, price, category, inventory, id]
        );
        return result.rows[0] || null;
    }
}

module.exports = ProductModel;
