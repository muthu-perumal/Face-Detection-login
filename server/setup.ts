import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { closePool, pool, withUser } from './db';

async function main() {
  const directory = path.join(process.cwd(), 'supabase', 'migrations');
  const files = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
  for (const name of files) {
    await pool.query(readFileSync(path.join(directory, name), 'utf8'));
  }
  await pool.query('GRANT app_user TO CURRENT_USER');
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || password.length < 8) {
    throw new Error('Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 8 characters before seeding.');
  }
  await withUser({ id: '', role: 'system' }, async (client) => {
    const existing = await client.query('SELECT id FROM lookup_login($1)', [email]);
    if (existing.rows[0]) {
      console.log(`Admin already exists: ${email}`);
      return;
    }
    const hash = await bcrypt.hash(password, 10);
    await client.query(
      `INSERT INTO profiles (employee_id, full_name, email, department, designation, role, status, password_hash)
       VALUES ('ADMIN', 'System Administrator', $1, 'Administration', 'Administrator', 'admin', 'active', $2)`,
      [email, hash],
    );
    console.log(`Created administrator ${email}`);
  });
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
