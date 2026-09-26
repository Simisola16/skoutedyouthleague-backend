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
    console.log(`\n>>> [CMD]: ${cmd.substring(0, 100)}...`);
    conn.exec(cmd, { pty: true }, (err, stream) => {
      if (err) {
        console.error('Exec error:', err.message);
        return resolve({ error: err.message });
      }
      let output = '';
      const timer = setTimeout(() => {
        console.warn('[TIMEOUT] Command took too long, continuing...');
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
        const str = d.toString();
        output += str;
        process.stdout.write(str);
      });
    });
  });
}

async function main() {
  conn.on('ready', async () => {
    console.log('\n✅ Connected to Ubuntu VPS (204.12.253.220)!');

    // Fix ownership
    await run(`echo "${PASSWORD}" | sudo -S chown -R administrator:administrator /var/www/backend`);
    await run(`git config --global --add safe.directory /var/www/backend`);

    // Pull latest code
    await run(`cd /var/www/backend && git fetch origin && git reset --hard origin/main`, 60000);

    // Update .env on server with the new SERVER_BASE_URL and existing secrets
    const MONGODB_URI = process.env.MONGODB_URI || 'REPLACE';
    const RESEND_PRIMARY_KEY = process.env.RESEND_PRIMARY_KEY || 'REPLACE';
    const RESEND_BACKUP_KEY = process.env.RESEND_BACKUP_KEY || 'REPLACE';
    const RESEND_API_KEY = process.env.RESEND_API_KEY || 'REPLACE';
    const CLOUDINARY_URL = process.env.CLOUDINARY_URL || 'REPLACE';
    const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'REPLACE';
    const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || 'REPLACE';
    const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || 'REPLACE';

    const envContent = [
      `PORT=5055`,
      `MONGODB_URI=${MONGODB_URI}`,
      `RESEND_PRIMARY_KEY=${RESEND_PRIMARY_KEY}`,
      `RESEND_BACKUP_KEY=${RESEND_BACKUP_KEY}`,
      `RESEND_API_KEY=${RESEND_API_KEY}`,
      `CLOUDINARY_URL=${CLOUDINARY_URL}`,
      `CLOUDINARY_CLOUD_NAME=${CLOUDINARY_CLOUD_NAME}`,
      `CLOUDINARY_API_KEY=${CLOUDINARY_API_KEY}`,
      `CLOUDINARY_API_SECRET=${CLOUDINARY_API_SECRET}`,
      `EMAIL_FROM="Skouted League <tournaments@thevillagecoders.com>"`,
      `SERVER_BASE_URL=https://api.skoutedyouthleague.com`
    ].join('\n');

    await run(`cat > /var/www/backend/.env << 'ENVEOF'\n${envContent}\nENVEOF`);
    await run(`echo "--- .env written ---" && head -2 /var/www/backend/.env`);

    // Restart pm2
    console.log('\n⟳ Restarting pm2...');
    const r1 = await run(`echo "${PASSWORD}" | sudo -S pm2 restart all`, 30000);
    if (r1.code !== 0 && !r1.timeout) {
      await run(`pm2 restart all`, 30000);
    }

    // Show pm2 status
    await run(`pm2 status`);

    // Quick health check
    console.log('\n🔍 Health check...');
    await run(`curl -s https://api.skoutedyouthleague.com/api/health`);

    // Test media route exists
    await run(`curl -s -o /dev/null -w "Media route HTTP status: %{http_code}\\n" "https://api.skoutedyouthleague.com/api/media/file/000000000000000000000001"`);

    console.log('\n✅ MongoDB GridFS Storage Deployment Complete!');
    conn.end();
  });

  conn.on('error', (err) => {
    console.error('\n❌ SSH Connection Error:', err.message);
    process.exit(1);
  });

  conn.on('end', () => {
    console.log('\nSSH connection closed.');
  });

  console.log('Connecting to 204.12.253.220:10001...');
  conn.connect(SSH_CONFIG);
}

main();
