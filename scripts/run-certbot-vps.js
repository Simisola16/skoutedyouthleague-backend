const { Client } = require('ssh2');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const VPS_HOST = process.env.VPS_HOST || '108.181.161.189';
const VPS_USER = process.env.VPS_USER || 'administrator';
const VPS_PASS = process.env.VPS_PASSWORD || process.env.VPS_PASS;
const VPS_PORT = parseInt(process.env.VPS_PORT || '22', 10);

const DOMAIN = 'api.skoutedyouthleague.com';
const EMAIL = 'tournaments@skoutedyouthleague.com';

if (!VPS_PASS) {
  console.error('❌ VPS_PASSWORD environment variable is required.');
  process.exit(1);
}

function runRemoteCommand(conn, cmd) {
  return new Promise((resolve, reject) => {
    console.log(`\n>>> [CMD]: ${cmd}`);
    conn.exec(cmd, { pty: true }, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      stream.on('close', (code) => {
        resolve({ code, stdout });
      });
      stream.on('data', (d) => {
        const text = d.toString();
        stdout += text;
        process.stdout.write(text);
        if (text.includes('[sudo]') || text.toLowerCase().includes('password:')) {
          stream.write(VPS_PASS + '\n');
        }
      });
    });
  });
}

async function main() {
  const conn = new Client();
  console.log(`[Certbot] Connecting to VPS (${VPS_HOST})...`);

  conn.on('ready', async () => {
    console.log('[Certbot] Connected via SSH!');
    try {
      console.log(`\n[Certbot] Running certbot for ${DOMAIN}...`);
      await runRemoteCommand(conn, `echo "${VPS_PASS}" | sudo -S certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos -m ${EMAIL} --redirect`);
      console.log('\n[Certbot] Reloading Nginx...');
      await runRemoteCommand(conn, `echo "${VPS_PASS}" | sudo -S systemctl reload nginx`);
      console.log('\n✅ Certbot execution finished!');
    } catch (err) {
      console.error('[Certbot Error]:', err.message);
    } finally {
      conn.end();
    }
  });

  conn.on('error', (err) => {
    console.error('SSH Error:', err.message);
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
