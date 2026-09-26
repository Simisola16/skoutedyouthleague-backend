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
    console.log('Connected to Ubuntu VPS (204.12.253.220)!');
    
    // Pull latest code
    await run('cd /var/www/backend && git fetch origin && git reset --hard origin/main');

    // Update keys from local .env dynamically
    const pKey = process.env.RESEND_PRIMARY_KEY || '';
    const bKey = process.env.RESEND_BACKUP_KEY || '';
    if (pKey) {
      await run(`sed -i "s/^RESEND_PRIMARY_KEY=.*/RESEND_PRIMARY_KEY=${pKey}/" /var/www/backend/.env`);
    }
    if (bKey) {
      await run(`sed -i "s/^RESEND_BACKUP_KEY=.*/RESEND_BACKUP_KEY=${bKey}/" /var/www/backend/.env`);
    }
    await run(`grep -q "^ADMIN_NOTIFICATION_EMAIL=" /var/www/backend/.env || echo "ADMIN_NOTIFICATION_EMAIL=maroophadek@gmail.com" >> /var/www/backend/.env`);

    // Restart PM2
    await run(`echo "${PASSWORD}" | sudo -S pm2 restart all`);
    await run(`echo "${PASSWORD}" | sudo -S pm2 status`);

    // Health check
    await run('curl -sI "https://api.skoutedyouthleague.com/logo.png" | head -n 5 ; echo ""');
    await run('curl -s "https://api.skoutedyouthleague.com/api/settings" | head -c 200 ; echo ""');

    console.log('\n✅ VPS Backend Pull & Restart Complete!');
    conn.end();
  });

  conn.on('error', (err) => {
    console.error('SSH Error:', err);
  });

  conn.connect(SSH_CONFIG);
}

main();
