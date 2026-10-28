const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const VPS_HOST = process.env.VPS_HOST || '108.181.161.189';
const VPS_USER = process.env.VPS_USER || 'administrator';
const VPS_PASS = process.env.VPS_PASSWORD || process.env.VPS_PASS;
const VPS_PORT = parseInt(process.env.VPS_PORT || '22', 10);

const TARGET_DIR = '/home/administrator/skouted-backend';

if (!VPS_PASS) {
  console.error('❌ VPS_PASSWORD environment variable is required.');
  process.exit(1);
}

function runRemoteCommand(conn, cmd, inputPassword = true) {
  return new Promise((resolve, reject) => {
    console.log(`\n>>> [REMOTE CMD]: ${cmd}`);
    conn.exec(cmd, { pty: true }, (err, stream) => {
      if (err) return reject(err);

      let stdout = '';
      let stderr = '';

      stream.on('close', (code) => {
        console.log(`<<< [DONE code: ${code}]`);
        resolve({ code, stdout, stderr });
      });

      stream.on('data', (d) => {
        const text = d.toString();
        stdout += text;
        process.stdout.write(text);

        if (inputPassword && (text.includes('[sudo]') || text.toLowerCase().includes('password:'))) {
          stream.write(VPS_PASS + '\n');
        }
      });

      stream.stderr.on('data', (d) => {
        const text = d.toString();
        stderr += text;
        process.stderr.write(text);
      });
    });
  });
}

async function main() {
  const conn = new Client();

  console.log(`[Deploy] Connecting to VPS (${VPS_HOST}:${VPS_PORT})...`);

  conn.on('ready', async () => {
    console.log('[Deploy] Connected via SSH successfully!');

    try {
      // 1. Ensure target directory exists and clone or pull repo
      console.log('\n--- Step 1: Clone / Update Repository ---');
      await runRemoteCommand(conn, `
        if [ ! -d "${TARGET_DIR}/.git" ]; then
          git clone https://github.com/Simisola16/skoutedyouthleague-backend.git ${TARGET_DIR}
        else
          cd ${TARGET_DIR} && git fetch origin && git reset --hard origin/main
        fi
      `);

      // 2. Sync local .env to VPS
      console.log('\n--- Step 2: Configure Environment Variables ---');
      const localEnvPath = path.resolve(__dirname, '../.env');
      if (fs.existsSync(localEnvPath)) {
        const envContent = fs.readFileSync(localEnvPath, 'utf8');
        await runRemoteCommand(conn, `cat << 'EOF' > ${TARGET_DIR}/.env\n${envContent}\nEOF`);
      }

      // 3. Install dependencies
      console.log('\n--- Step 3: Install Production Dependencies ---');
      await runRemoteCommand(conn, `cd ${TARGET_DIR} && npm install --omit=dev`);

      // 4. Test MongoDB Atlas connectivity from the VPS
      console.log('\n--- Step 4: Verify MongoDB Connection from VPS ---');
      await runRemoteCommand(conn, `cd ${TARGET_DIR} && node -e "
        const mongoose = require('mongoose');
        require('dotenv').config();
        mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 })
          .then(() => {
            console.log('✅ MongoDB connection OK from new VPS!');
            process.exit(0);
          })
          .catch((err) => {
            console.error('❌ MongoDB connection error on VPS:', err.message);
            process.exit(1);
          });
      "`);

      // 5. Setup PM2 Process (safely managing only skouted-backend)
      console.log('\n--- Step 5: Start / Restart PM2 Process ---');
      await runRemoteCommand(conn, `
        pm2 stop skouted-backend 2>/dev/null || true
        pm2 delete skouted-backend 2>/dev/null || true
        cd ${TARGET_DIR} && pm2 start index.js --name skouted-backend --update-env
        pm2 save
        pm2 status
      `);

      // 6. Test local backend health on VPS
      console.log('\n--- Step 6: Test Local Port 5055 Health Endpoint ---');
      await new Promise(r => setTimeout(r, 2000));
      await runRemoteCommand(conn, `curl -s http://127.0.0.1:5055/api/health`);

      // 7. Setup Nginx Configuration
      console.log('\n--- Step 7: Configure Nginx Reverse Proxy ---');
      const nginxConfig = `server {
    listen 80;
    server_name api.skoutedyouthleague.com;

    client_max_body_size 50M;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:5055;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    location / {
        proxy_pass http://127.0.0.1:5055;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
    }
}
`;

      await runRemoteCommand(conn, `echo "${VPS_PASS}" | sudo -S bash -c 'cat << "EOF" > /etc/nginx/sites-available/skouted-backend\n${nginxConfig}\nEOF'`);
      await runRemoteCommand(conn, `echo "${VPS_PASS}" | sudo -S ln -sf /etc/nginx/sites-available/skouted-backend /etc/nginx/sites-enabled/`);
      await runRemoteCommand(conn, `echo "${VPS_PASS}" | sudo -S nginx -t`);
      await runRemoteCommand(conn, `echo "${VPS_PASS}" | sudo -S systemctl reload nginx`);

      console.log('\n======================================================');
      console.log('🎉 BACKEND DEPLOYMENT TO VPS FINISHED SUCCESSFULLY!');
      console.log('======================================================');

    } catch (err) {
      console.error('\n❌ Deployment failed:', err);
    } finally {
      conn.end();
    }
  });

  conn.on('error', (err) => {
    console.error('[SSH Connection Error]:', err.message);
  });

  conn.connect({
    host: VPS_HOST,
    port: VPS_PORT,
    username: VPS_USER,
    password: VPS_PASS,
    readyTimeout: 30000
  });
}

main();
