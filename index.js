'use strict';
// SnapDeploy-compatible launcher: same VLESS+WS logic as the Velixir version,
// but all runtime writes go to a writable tmp directory, not /app.
// SnapDeploy's /app is read-only at runtime, so writing xray.zip / config.json
// there crashes with EACCES. /tmp is writable in the container.
// TLS is still terminated by the platform edge, Xray itself is plaintext WS.
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');

const PORT = process.env.PORT || '8080';
const UUID = process.env.UUID;
const WS_PATH = process.env.WS_PATH || '/ws';
if (!UUID) { console.error('Missing env UUID'); process.exit(1); }
if (!WS_PATH.startsWith('/')) { console.error('WS_PATH must start with /'); process.exit(1); }

const WORKDIR = path.join(os.tmpdir(), 'xray-runtime');
fs.mkdirSync(WORKDIR, { recursive: true });
const ZIP = path.join(WORKDIR, 'xray.zip');
const BIN = path.join(WORKDIR, 'xray');
const CONFIG = path.join(WORKDIR, 'config.json');
const URL = 'https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip';

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close(); fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error('download status ' + res.statusCode));
      res.pipe(file); file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });
}

(async () => {
  if (!fs.existsSync(BIN)) {
    console.log('Downloading Xray-core...');
    await download(URL, ZIP);
    new AdmZip(ZIP).extractAllTo(WORKDIR, true);
    fs.chmodSync(BIN, 0o755);
    try { fs.unlinkSync(ZIP); } catch {}
  }
  const config = {
    log: { loglevel: 'warning' },
    inbounds: [{
      port: Number(PORT), listen: '0.0.0.0', protocol: 'vless',
      settings: { clients: [{ id: UUID }], decryption: 'none' },
      streamSettings: { network: 'ws', wsSettings: { path: WS_PATH } },
    }],
    outbounds: [{ protocol: 'freedom', tag: 'direct' }],
  };
  fs.writeFileSync(CONFIG, JSON.stringify(config));
  console.log('Starting xray on port ' + PORT + ' ws path ' + WS_PATH);
  const child = spawn(BIN, ['run', '-c', CONFIG], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code || 0));
})();
