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

    console.log('\n--- Pulling latest backend code ---');
    await run(`cd /var/www/backend && git fetch origin && git reset --hard origin/main`);

    console.log('\n--- Restarting user pm2 ---');
    await run(`pm2 restart skouted-backend || pm2 restart all`);
    await run(`pm2 status`);

    console.log('\n--- Health check ---');
    await new Promise(r => setTimeout(r, 2000));
    await run(`curl -s https://api.skoutedyouthleague.com/api/health`);

    console.log('\n--- Testing /api/gallery public endpoint ---');
    await run(`curl -s "https://api.skoutedyouthleague.com/api/gallery" | head -c 300`);

    console.log('\n--- Testing /api/gallery?category=undefined&search=undefined endpoint ---');
    await run(`curl -s "https://api.skoutedyouthleague.com/api/gallery?category=undefined&search=undefined" | head -c 300`);

    console.log('\n🎉 Deploy completed successfully!');
    conn.end();
  });

  conn.on('error', (err) => {
    console.error('\n❌ SSH Error:', err.message);
    process.exit(1);
  });

  console.log('Connecting to server...');
  conn.connect(SSH_CONFIG);
}

main();
