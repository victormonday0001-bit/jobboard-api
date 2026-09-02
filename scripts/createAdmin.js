/**
 * Create Admin Script
 * Usage: node scripts/createAdmin.js email password firstname lastname
 * Example: node scripts/createAdmin.js admin@jobboard.com Admin123! Admin User
 */
require('dotenv').config();
const bcrypt   = require('bcrypt');
const { pool } = require('../config/db');

const createAdmin = async () => {
  const email      = process.argv[2] || 'admin@jobboard.com';
  const password   = process.argv[3] || 'Admin123!';
  const first_name = process.argv[4] || 'Admin';
  const last_name  = process.argv[5] || 'User';

  try {
    const existing = await pool.query('SELECT id, role FROM users WHERE email = $1', [email]);

    if (existing.rows.length) {
      await pool.query(
        `UPDATE users SET role = 'admin', is_verified = TRUE, is_active = TRUE WHERE email = $1`,
        [email]
      );
      console.log(`✅ Existing user ${email} upgraded to admin.`);
      process.exit(0);
    }

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_verified)
       VALUES ($1,$2,$3,$4,'admin',TRUE) RETURNING id, email, role`,
      [email, hash, first_name, last_name]
    );

    console.log('✅ Admin account created:');
    console.log(`   Email:    ${rows[0].email}`);
    console.log(`   Password: ${password}`);
    console.log(`   Role:     ${rows[0].role}`);
    console.log('');
    console.log('⚠️  Change your password after first login!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error creating admin:', err.message);
    process.exit(1);
  }
};

createAdmin();
