const { Client } = require('ssh2');

const conn = new Client();
const PASSWORD = 'Skouted@123';

const SSH_CONFIG = {
  host: '204.12.253.220',
  port: 10001,
  username: 'administrator',
  password: PASSWORD
};

conn.on('ready', () => {
  console.log('Connected! Restarting root pm2...');
  const cmd = `echo '${PASSWORD}' | sudo -S pm2 restart all && echo '${PASSWORD}' | sudo -S pm2 status`;
  conn.exec(cmd, (err, stream) => {
    if (err) {
      console.error(err);
      conn.end();
      return;
    }
    stream.on('data', d => process.stdout.write(d));
    stream.on('close', () => {
      console.log('\nRestart finished!');
      conn.end();
    });
  });
}).on('error', console.error).connect(SSH_CONFIG);
