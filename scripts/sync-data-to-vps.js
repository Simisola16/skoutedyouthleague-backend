const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const VPS_HOST = process.env.VPS_HOST || '108.181.161.189';
const VPS_USER = process.env.VPS_USER || 'administrator';
const VPS_PASS = process.env.VPS_PASSWORD || process.env.VPS_PASS;
const VPS_PORT = parseInt(process.env.VPS_PORT || '22', 10);

const LOCAL_BACKUP_DIR = path.resolve(__dirname, '../backups/latest');
const REMOTE_BACKUP_DIR = '/home/administrator/skouted-backend/backups/latest';

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
        stdout += d.toString();
        process.stdout.write(d.toString());
      });
    });
  });
}

function uploadFile(sftp, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function main() {
  const conn = new Client();
  console.log('[Data Sync] Connecting to VPS...');

  conn.on('ready', async () => {
    console.log('[Data Sync] Connected via SSH!');

    try {
      // 1. Create remote backup directory
      await runRemoteCommand(conn, `mkdir -p ${REMOTE_BACKUP_DIR}`);

      // 2. Upload all backup JSON files via SFTP
      conn.sftp(async (err, sftp) => {
        if (err) throw err;

        const files = fs.readdirSync(LOCAL_BACKUP_DIR);
        console.log(`\n[Data Sync] Uploading ${files.length} backup data files to ${REMOTE_BACKUP_DIR}...`);

        for (const file of files) {
          const localFilePath = path.join(LOCAL_BACKUP_DIR, file);
          const remoteFilePath = `${REMOTE_BACKUP_DIR}/${file}`;
          const stat = fs.statSync(localFilePath);
          process.stdout.write(`  ⬆️ Uploading ${file} (${(stat.size / 1024).toFixed(1)} KB)... `);
          await uploadFile(sftp, localFilePath, remoteFilePath);
          console.log('✅ Done');
        }

        console.log('\n[Data Sync] All backup files uploaded to VPS!');

        // 3. Restore data to local mongod (port 27017) on the VPS as a physical backup database
        console.log('\n[Data Sync] Restoring data into local MongoDB (127.0.0.1:27017) on the VPS...');
        await runRemoteCommand(conn, `cd /home/administrator/skouted-backend && TARGET_MONGODB_URI="mongodb://127.0.0.1:27017/skoutedLeague" node scripts/restore-database.js`);

        console.log('\n======================================================');
        console.log('🎉 ALL DATA HAS BEEN TRANSFERRED AND RESTORED ON VPS!');
        console.log('======================================================');

        conn.end();
      });

    } catch (e) {
      console.error('[Data Sync Error]:', e);
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
