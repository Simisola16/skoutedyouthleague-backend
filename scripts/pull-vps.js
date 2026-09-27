const { Client } = require('ssh2');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const conn = new Client();
const PASSWORD = 'Skouted@123';

const SSH_CONFIG = {
  host: '204.12.253.220',
  port: 10001,
  username: 'administrator',
  password: PASSWORD,
  readyTimeout: 30000
};

function run(cmd) {
  return new Promise((resolve) => {
    console.log(`\n>>> [CMD]: ${cmd}`);
    conn.exec(cmd, { pty: true }, (err, stream) => {
      if (err) return resolve({ error: err.message });
      let output = '';
      stream.on('close', (code) => {
        resolve({ code, output });
      });
      stream.on('data', (d) => {
        const str = d.toString();
        output += str;
        process.stdout.write(str);
        if (str.includes('[sudo]') || str.toLowerCase().includes('password:')) {
          stream.write(PASSWORD + '\n');
        }
      });
    });
  });
}

async function main() {
  conn.on('ready', async () => {
    console.log('Connected to Ubuntu VPS (204.12.253.220:10001)!');
    
    // 1. Pull latest code
    await run('cd /var/www/backend && git fetch origin && git reset --hard origin/main');

    // 2. Install production dependencies
    await run('cd /var/www/backend && npm install --omit=dev');

    // 3. Environment variables sync (reads from local .env)
    const pKey = process.env.RESEND_PRIMARY_KEY;
    const bKey = process.env.RESEND_BACKUP_KEY;
    const socialSecret = process.env.SOCIAL_SYNC_SECRET || 'skouted_social_sync_secret_2026';

    if (pKey) {
      await run(`sed -i "s/^RESEND_PRIMARY_KEY=.*/RESEND_PRIMARY_KEY=${pKey}/" /var/www/backend/.env`);
    }
    if (bKey) {
      await run(`sed -i "s/^RESEND_BACKUP_KEY=.*/RESEND_BACKUP_KEY=${bKey}/" /var/www/backend/.env`);
    }
    await run(`grep -q "^SOCIAL_SYNC_SECRET=" /var/www/backend/.env && sed -i "s/^SOCIAL_SYNC_SECRET=.*/SOCIAL_SYNC_SECRET=${socialSecret}/" /var/www/backend/.env || echo "SOCIAL_SYNC_SECRET=${socialSecret}" >> /var/www/backend/.env`);
    await run(`grep -q "^ADMIN_NOTIFICATION_EMAIL=" /var/www/backend/.env || echo "ADMIN_NOTIFICATION_EMAIL=maroophadek@gmail.com" >> /var/www/backend/.env`);

    // 4. Clean and restart PM2 under administrator
    await run('echo "Skouted@123" | sudo -S pm2 delete all 2>/dev/null || true');
    await run('pm2 delete all 2>/dev/null || true');
    await run('echo "Skouted@123" | sudo -S fuser -k 5055/tcp 2>/dev/null || true');
    await run('cd /var/www/backend && pm2 start index.js --name skouted-backend --update-env');
    await run('pm2 save');
    await run('pm2 status');

    // 5. Verification
    await new Promise(r => setTimeout(r, 2000));
    await run('curl -sI "https://api.skoutedyouthleague.com/api/social/posts?limit=3" | head -n 6 ; echo ""');

    console.log('\n✅ VPS Backend Pull & Restart Complete!');
    conn.end();
  });

  conn.on('error', (err) => {
    console.error('SSH Error:', err);
  });

  conn.connect(SSH_CONFIG);
}

main();
