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

    // Test 127.0.0.1:5055
    await run('curl -i http://127.0.0.1:5055/api/health');

    // Update nginx proxy to 127.0.0.1:5055 instead of localhost
    const conf = `server {
    listen 80 default_server;
    server_name api.skoutedyouthleague.com;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        proxy_pass http://127.0.0.1:5055;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \\$host;
        proxy_cache_bypass \\$http_upgrade;
        proxy_set_header X-Real-IP \\$remote_addr;
        proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\$scheme;
    }
}`;

    await run(`echo "Skouted@123" | sudo -S bash -c 'cat << "EOF" > /etc/nginx/sites-available/skouted-backend\n${conf}\nEOF'`);
    await run('echo "Skouted@123" | sudo -S nginx -t');
    await run('echo "Skouted@123" | sudo -S systemctl reload nginx');

    // Test nginx again
    await run('curl -i http://localhost/api/health');

    conn.end();
  });
  conn.connect(SSH_CONFIG);
}

main();
