const { Client } = require('ssh2');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const conn = new Client();
const PASSWORD = 'Skouted@123';

const SSH_CONFIG = {
  host: '204.12.253.220',
  port: 10001,
  username: 'administrator',
  password: PASSWORD,
  readyTimeout: 45000
};

function run(cmd, timeoutMs = 60000) {
  return new Promise((resolve) => {
    console.log(`\n>>> [CMD]: ${cmd.substring(0, 120)}`);
    conn.exec(cmd, { pty: true }, (err, stream) => {
      if (err) {
        console.error('Exec error:', err.message);
        return resolve({ error: err.message });
      }
      let output = '';
      const timer = setTimeout(() => {
        console.warn('[TIMEOUT] continuing...');
        resolve({ code: -1, output, timeout: true });
      }, timeoutMs);

      stream.on('close', (code) => {
        clearTimeout(timer);
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
      stream.stderr.on('data', (d) => {
        process.stdout.write(d.toString());
      });
    });
  });
}

async function main() {
  conn.on('ready', async () => {
    console.log('\n✅ Connected to Ubuntu VPS!');

    // Diagnose: which pm2 is nginx connecting to?
    console.log('\n--- Diagnosing pm2 instances ---');
    await run(`pm2 status`);
    await run(`echo "${PASSWORD}" | sudo -S pm2 status`);
    await run(`echo "${PASSWORD}" | sudo -S pm2 list`);

    // Check what port the process is listening on
    await run(`echo "${PASSWORD}" | sudo -S netstat -tlnp 2>/dev/null | grep 5055 || echo "${PASSWORD}" | sudo -S ss -tlnp | grep 5055`);

    // Check nginx config to understand what upstream it's hitting
    await run(`echo "${PASSWORD}" | sudo -S cat /etc/nginx/sites-enabled/default 2>/dev/null | head -30 || echo "${PASSWORD}" | sudo -S cat /etc/nginx/nginx.conf | head -40`);

    // Try starting the app as the administrator user (non-sudo pm2)
    console.log('\n--- Starting app under user pm2 ---');
    await run(`cd /var/www/backend && pm2 delete all 2>/dev/null; pm2 start index.js --name skouted-backend`);
    await run(`pm2 save`);
    await run(`pm2 status`);

    // Quick health check
    await new Promise(r => setTimeout(r, 3000));
    await run(`curl -s https://api.skoutedyouthleague.com/api/health`);

    console.log('\n✅ Done.');
    conn.end();
  });

  conn.on('error', (err) => {
    console.error('\n❌ SSH Error:', err.message);
    process.exit(1);
  });

  console.log('Connecting...');
  conn.connect(SSH_CONFIG);
}

main();
