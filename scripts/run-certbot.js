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

    // 1. Create directory structure
    await run('echo "Skouted@123" | sudo -S mkdir -p /var/www/html/.well-known/acme-challenge');
    await run('echo "Skouted@123" | sudo -S chmod -R 755 /var/www/html');
    await run('echo "test1234" | sudo tee /var/www/html/.well-known/acme-challenge/test.txt');

    // 2. Test local fetch of challenge test file
    await run('curl -i http://localhost/.well-known/acme-challenge/test.txt');

    // 3. Run certbot with webroot
    await run('echo "Skouted@123" | sudo -S certbot certonly --webroot -w /var/www/html -d api.skoutedyouthleague.com --non-interactive --agree-tos -m tournaments@thevillagecoders.com');

    conn.end();
  });
  conn.connect(SSH_CONFIG);
}

main();
