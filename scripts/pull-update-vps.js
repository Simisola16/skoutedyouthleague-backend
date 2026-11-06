const { Client } = require('ssh2');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const VPS_HOST = process.env.VPS_HOST || '108.181.161.189';
const VPS_USER = process.env.VPS_USER || 'administrator';
const VPS_PASS = process.env.VPS_PASSWORD || process.env.VPS_PASS || 'villagecoders@7';
const VPS_PORT = parseInt(process.env.VPS_PORT || '22', 10);
const TARGET_DIR = '/home/administrator/skouted-backend';

const conn = new Client();

conn.on('ready', () => {
  console.log('Connected to VPS!');
  const cmd = `cd ${TARGET_DIR} && git pull origin main && pm2 restart skouted-backend`;
  conn.exec(cmd, { pty: true }, (err, stream) => {
    if (err) {
      console.error(err);
      conn.end();
      return;
    }
    stream.on('close', (code) => {
      console.log('Finished with code:', code);
      conn.end();
    });
    stream.on('data', (d) => process.stdout.write(d.toString()));
    stream.stderr.on('data', (d) => process.stderr.write(d.toString()));
  });
}).on('error', (err) => {
  console.error('Connection error:', err);
}).connect({
  host: VPS_HOST,
  port: VPS_PORT,
  username: VPS_USER,
  password: VPS_PASS
});
