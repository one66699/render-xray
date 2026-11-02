'use strict';
// Velixir launcher: downloads Xray-core at runtime, writes a VLESS+WS config
// from environment variables, and runs it on process.env.PORT.
// Do NOT hardcode UUID or path in source: set them as Velixir env vars
//   UUID    - VLESS client id (uuid format)
//   WS_PATH - WebSocket path, e.g. /ws-xxxx (must start with /)
// TLS note: Velixir edge terminates TLS for *.velixir.run and forwards
// plaintext HTTP/WebSocket to the container, so streamSettings here is
// ws without tls. The client uses security=tls, port 443, sni=<app>.velixir.run.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');

const PORT = process.env.PORT || '8080';
const UUID = process.env.UUID;
const WS_PATH = process.env.WS_PATH || '/ws';
if (!UUID) { console.error('Missing env UUID'); process.exit(1); }
if (!WS_PATH.startsWith('/')) { console.error('WS_PATH must start with /'); process.exit(1); }

const DIR = __dirname;
const ZIP = path.join(DIR, 'xray.zip');
const BIN = path.join(DIR, 'xray');
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
    new AdmZip(ZIP).extractAllTo(DIR, true);
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
  fs.writeFileSync(path.join(DIR, 'config.json'), JSON.stringify(config));
  console.log('Starting xray on port ' + PORT + ' ws path ' + WS_PATH);
  const child = spawn(BIN, ['run', '-c', path.join(DIR, 'config.json')], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code || 0));
})();
