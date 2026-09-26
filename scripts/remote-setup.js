const { Client } = require('ssh2');

const conn = new Client();

const SSH_CONFIG = {
  host: '204.12.253.220',
  port: 10001,
  username: 'administrator',
  password: 'Skouted@123',
  readyTimeout: 30000
};

const PASSWORD = 'Skouted@123';

function runRemoteCommand(conn, cmd) {
  return new Promise((resolve, reject) => {
    console.log(`\n>>> EXECUTING: ${cmd}`);
    conn.exec(cmd, { pty: true }, (err, stream) => {
      if (err) return reject(err);

      let stdout = '';
      let stderr = '';

      stream.on('close', (code, signal) => {
        console.log(`<<< FINISHED [Exit Code: ${code}]`);
        resolve({ code, stdout, stderr });
      });

      stream.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        process.stdout.write(text);

        // Auto-reply to sudo password prompt if requested
        if (text.includes('[sudo] password for') || text.toLowerCase().includes('password:')) {
          stream.write(PASSWORD + '\n');
        }
      });

      stream.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        process.stderr.write(text);
      });
    });
  });
}

async function main() {
  console.log('[Remote Setup] Connecting to Ubuntu server at 204.12.253.220:10001...');

  conn.on('ready', async () => {
    console.log('[Remote Setup] Successfully connected via SSH!');

    try {
      // 1. Stop nginx temporarily
      await runRemoteCommand(conn, `echo "${PASSWORD}" | sudo -S systemctl stop nginx`);

      // 2. Request SSL Certificate via standalone
      console.log('\n[Remote Setup] Requesting SSL Certificate from Let\'s Encrypt for api.skoutedyouthleague.com...');
      await runRemoteCommand(conn, `echo "${PASSWORD}" | sudo -S certbot certonly --standalone -d api.skoutedyouthleague.com --non-interactive --agree-tos -m tournaments@thevillagecoders.com`);

      // 3. Remove conflicting default site
      await runRemoteCommand(conn, `echo "${PASSWORD}" | sudo -S rm -f /etc/nginx/sites-enabled/default`);

      // 4. Write Nginx SSL & Reverse Proxy Config
      const nginxConfig = `server {
    listen 80;
    server_name api.skoutedyouthleague.com;
    return 301 https://\\$host\\$request_uri;
}

server {
    listen 443 ssl;
    server_name api.skoutedyouthleague.com;

    ssl_certificate /etc/letsencrypt/live/api.skoutedyouthleague.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.skoutedyouthleague.com/privkey.pem;

    location / {
        proxy_pass http://localhost:5055;
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

      await runRemoteCommand(conn, `echo "${PASSWORD}" | sudo -S bash -c 'cat << "EOF" > /etc/nginx/sites-available/skouted-backend\n${nginxConfig}\nEOF'`);

      // 5. Enable site
      await runRemoteCommand(conn, `echo "${PASSWORD}" | sudo -S ln -sf /etc/nginx/sites-available/skouted-backend /etc/nginx/sites-enabled/`);

      // 6. Test and start nginx
      await runRemoteCommand(conn, `echo "${PASSWORD}" | sudo -S nginx -t`);
      await runRemoteCommand(conn, `echo "${PASSWORD}" | sudo -S systemctl start nginx`);
      await runRemoteCommand(conn, `echo "${PASSWORD}" | sudo -S systemctl enable nginx`);

      // 7. Verify PM2 process is running backend
      await runRemoteCommand(conn, `pm2 status`);

      // 8. Test health endpoint locally and over HTTPS
      console.log('\n[Remote Setup] Testing backend health endpoint...');
      await runRemoteCommand(conn, `curl -I https://api.skoutedyouthleague.com/api/health`);
      await runRemoteCommand(conn, `curl https://api.skoutedyouthleague.com/api/health`);

      console.log('\n========================================================');
      console.log('✅ ALL REMOTE SETUP TASKS COMPLETED SUCCESSFULLY!');
      console.log('========================================================');
    } catch (err) {
      console.error('[Remote Setup Error]:', err);
    } finally {
      conn.end();
    }
  });

  conn.on('error', (err) => {
    console.error('[SSH Connection Error]:', err);
  });

  conn.connect(SSH_CONFIG);
}

main();
