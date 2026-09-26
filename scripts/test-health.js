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
    console.log('Connected!');
    await run('git config --global --add safe.directory /var/www/backend');
    await run('echo "Skouted@123" | sudo -S git config --global --add safe.directory /var/www/backend');
    await run('echo "Skouted@123" | sudo -S bash -c "cd /var/www/backend && git pull origin main"');
    await run('echo "Skouted@123" | sudo -S pm2 restart skouted-backend');
    await run('sleep 3');
    await run('echo "Skouted@123" | sudo -S pm2 logs skouted-backend --lines 25 --nostream');
    await run('curl -i http://localhost/api/health');
    await run('curl -i http://localhost/api/gallery');
    conn.end();
  });
  conn.connect(SSH_CONFIG);
}

main();
