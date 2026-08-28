const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const root = path.resolve(__dirname, '..');
const secretDir = path.join(root, 'secrets');
const argumentsMap = new Map(process.argv.slice(2).map((item) => {
  const [key, ...value] = item.split('=');
  return [key, value.join('=')];
}));

async function createSecret(filename, value = crypto.randomBytes(48).toString('base64url')) {
  const target = path.join(secretDir, filename);
  try {
    await fs.writeFile(target, `${value}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return 'criado';
  } catch (error) {
    if (error.code === 'EEXIST') return 'preservado';
    throw error;
  }
}

async function prepareEnvironment() {
  const target = path.join(root, '.env.free');
  try {
    await fs.access(target);
  } catch {
    await fs.copyFile(path.join(root, '.env.free.example'), target);
  }
  let content = await fs.readFile(target, 'utf8');
  for (const [argument, key] of [['--host', 'SITE_HOST'], ['--email', 'ACME_EMAIL']]) {
    const value = argumentsMap.get(argument);
    if (!value) continue;
    const line = `${key}=${value}`;
    content = new RegExp(`^${key}=.*$`, 'm').test(content)
      ? content.replace(new RegExp(`^${key}=.*$`, 'm'), line)
      : `${content.trim()}\n${line}\n`;
  }
  await fs.writeFile(target, content, { encoding: 'utf8', mode: 0o600 });
}

async function main() {
  await Promise.all([
    fs.mkdir(secretDir, { recursive: true }),
    fs.mkdir(path.join(root, 'data-production'), { recursive: true }),
    fs.mkdir(path.join(root, 'backups-production'), { recursive: true }),
  ]);
  const results = await Promise.all([
    createSecret('postgres_password.txt'),
    createSecret('sync_secret.txt'),
    createSecret('admin_secret.txt'),
    createSecret('portal_transparencia_token.txt', ''),
    createSecret('datajud_api_key.txt', ''),
    createSecret('google_fact_check_api_key.txt', ''),
  ]);
  await prepareEnvironment();
  console.log(`Produção preparada. Segredos: ${results.join(', ')}. Edite somente SITE_HOST, ACME_EMAIL e opções não sigilosas em .env.free.`);
}

main().catch((error) => {
  console.error(`Não foi possível preparar a produção: ${error.message}`);
  process.exit(1);
});
