const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function download(url) {
  const result = spawnSync('curl', [
    '--silent', '--show-error', '--location', '--compressed',
    '--connect-timeout', '5', '--max-time', '15',
    '--write-out', '\n%{http_code}\n%{content_type}', url,
  ], { encoding: 'utf8', timeout: 18000, maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    return { error: (result.stderr || result.error?.message || `curl exited ${result.status}`).trim() };
  }
  const lines = result.stdout.split('\n');
  const contentType = lines.pop();
  const status = Number(lines.pop());
  return { status, contentType, body: lines.join('\n') };
}

function checkSite(base, expectedWorker, read = download) {
  const report = { base, status: 'verified', details: [] };
  function get(file) {
    const url = new URL(file, base);
    url.searchParams.set('fc-verify', `${expectedWorker}-${Date.now()}`);
    const result = read(url.href);
    if (result.error) {
      report.status = 'unreachable';
      report.details.push(`${file}: ${result.error}`);
      return null;
    }
    if (result.status !== 200) {
      report.status = 'incomplete';
      report.details.push(`${file}: HTTP ${result.status}`);
      return null;
    }
    return result;
  }

  const worker = get('fc-worker.js');
  if (!worker) return report;
  const currentWorker = worker.body.match(/const CACHE_VERSION = '([^']+)'/)?.[1];
  if (currentWorker !== expectedWorker) {
    report.status = currentWorker ? 'different-release' : 'incomplete';
    report.details.push(`Worker: ${currentWorker || 'not a Full Circle worker'}; expected ${expectedWorker}.`);
    return report;
  }
  report.details.push(`Worker: ${currentWorker}.`);

  const manifestResponse = get('release-manifest.json');
  if (!manifestResponse) return report;
  let manifest;
  try {
    manifest = JSON.parse(manifestResponse.body);
    if (!manifest['index.html']?.file) throw new Error('No application entry');
  } catch {
    report.status = 'incomplete';
    report.details.push('release-manifest.json: not a valid application manifest (possibly an HTML fallback).');
    return report;
  }

  const entryFile = manifest['index.html'].file;
  const entryUrl = new URL(entryFile, base);
  if (entryUrl.origin !== new URL(base).origin || !entryUrl.pathname.startsWith(new URL(base).pathname + 'assets/')) {
    report.status = 'incomplete';
    report.details.push('The manifest entry is not an application asset on this host.');
    return report;
  }
  const html = get('index.html');
  if (!html) return report;
  if (!html.body.includes(`src="./${entryFile}"`) && !html.body.includes(`src="/${entryFile}"`)) {
    report.status = 'incomplete';
    report.details.push('The page and release manifest reference different application bundles.');
    return report;
  }
  const entry = get(entryFile);
  if (!entry) return report;
  if (!/(?:java|ecma)script/i.test(entry.contentType || '') || /^\s*</.test(entry.body)) {
    report.status = 'incomplete';
    report.details.push(`The application bundle returned ${entry.contentType || 'an unknown content type'} instead of JavaScript.`);
    return report;
  }
  report.details.push(`Matching page, manifest and readable application bundle: ${entryFile}.`);
  return report;
}

function main() {
  const dist = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist'));
  const expectedWorker = fs.readFileSync(path.join(dist, 'fc-worker.js'), 'utf8').match(/const CACHE_VERSION = '([^']+)'/)?.[1];
  if (!expectedWorker) throw new Error('The prepared release has no worker version.');
  const sites = process.argv.slice(3);
  if (!sites.length) sites.push('https://tnsorganization.github.io/Full-Circle/', 'https://fullcircle.partnertai.com/');
  const reports = sites.map((site) => {
    console.log(`\nChecking ${site}`);
    const report = checkSite(site, expectedWorker);
    console.log(`Status: ${report.status}`);
    for (const detail of report.details) console.log(`  ${detail}`);
    return report;
  });
  if (reports.some((report) => report.status === 'unreachable')) {
    console.log('\nA network check failed. This does NOT establish that the website is outdated. No files were changed.');
  }
  if (reports.some((report) => ['incomplete', 'different-release'].includes(report.status))) {
    console.log('\nA host answered but its release files need attention. A source push does not itself upload to Hostinger.');
  }
  if (reports.every((report) => report.status === 'verified')) {
    console.log('\nPublished startup files verified on all checked sites. This does not test signed-in user sessions.');
  } else {
    console.log('Do not repeat database migrations or republish a site that already verified successfully.');
    process.exitCode = reports.some((report) => report.status === 'unreachable') ? 2 : 1;
  }
}

module.exports = { checkSite };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
