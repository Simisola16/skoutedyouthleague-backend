const { Client } = require('ssh2');

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

    // Restart PM2
    await run(`echo "${PASSWORD}" | sudo -S pm2 restart all`);
    await run(`echo "${PASSWORD}" | sudo -S pm2 status`);

    // Test GET /api/fixtures?featured=true live
    await run('curl -s "https://api.skoutedyouthleague.com/api/fixtures?featured=true&limit=3" | head -c 300 ; echo ""');

    console.log('\n✅ VPS Backend Pull & Restart Complete!');
    conn.end();
  });

  conn.on('error', (err) => {
    console.error('SSH Error:', err);
  });

  conn.connect(SSH_CONFIG);
}

main();
