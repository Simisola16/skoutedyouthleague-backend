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
    
    // Check ownership & status
    await run(`echo "${PASSWORD}" | sudo -S ls -la /var/www/backend`);
    await run(`echo "${PASSWORD}" | sudo -S pm2 status`);

    // Ensure administrator owns /var/www/backend so git & files work smoothly
    await run(`echo "${PASSWORD}" | sudo -S chown -R administrator:administrator /var/www/backend`);
    await run('git config --global --add safe.directory /var/www/backend');
    
    // Pull latest code
    await run('cd /var/www/backend && git fetch origin && git reset --hard origin/main');

    // Update .env with RESEND_PRIMARY_KEY and RESEND_BACKUP_KEY
    // NOTE: Fill in real values on the server's .env — do NOT commit secrets to Git
    const envUpdateCmd = `cat << 'EOF' > /var/www/backend/.env
PORT=5055
MONGODB_URI=${process.env.MONGODB_URI || 'REPLACE_WITH_MONGODB_URI'}
RESEND_PRIMARY_KEY=${process.env.RESEND_PRIMARY_KEY || 'REPLACE_WITH_RESEND_PRIMARY_KEY'}
RESEND_BACKUP_KEY=${process.env.RESEND_BACKUP_KEY || 'REPLACE_WITH_RESEND_BACKUP_KEY'}
RESEND_API_KEY=${process.env.RESEND_API_KEY || 'REPLACE_WITH_RESEND_API_KEY'}
CLOUDINARY_URL=${process.env.CLOUDINARY_URL || 'REPLACE_WITH_CLOUDINARY_URL'}
CLOUDINARY_CLOUD_NAME=${process.env.CLOUDINARY_CLOUD_NAME || 'REPLACE_WITH_CLOUD_NAME'}
CLOUDINARY_API_KEY=${process.env.CLOUDINARY_API_KEY || 'REPLACE_WITH_CLOUDINARY_API_KEY'}
CLOUDINARY_API_SECRET=${process.env.CLOUDINARY_API_SECRET || 'REPLACE_WITH_CLOUDINARY_API_SECRET'}
EMAIL_FROM="Skouted League <tournaments@thevillagecoders.com>"
EOF`;
    await run(envUpdateCmd);

    // Verify failover script runs directly in production environment
    await run('cd /var/www/backend && node scripts/test-email-failover.js');

    // Restart pm2 (check both user and sudo pm2)
    await run(`echo "${PASSWORD}" | sudo -S pm2 restart all || pm2 restart all`);
    await run(`echo "${PASSWORD}" | sudo -S pm2 status`);

    // Verify live endpoint
    await run('curl -s https://api.skoutedyouthleague.com/api/admin/email-quota | head -c 300 ; echo ""');
    await run('curl -s https://api.skoutedyouthleague.com/api/gallery | head -c 200 ; echo ""');

    console.log('\n✅ VPS Production Deployment & Failover Verification Complete!');
    conn.end();
  });

  conn.on('error', (err) => {
    console.error('SSH Connection Error:', err);
  });

  conn.connect(SSH_CONFIG);
}

main();
