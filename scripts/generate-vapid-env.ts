import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";

type EnvValues = Record<string, string>;

type VapidKeyPair = {
  privateKey: string;
  publicKey: string;
};

type FrontendEnvPaths = {
  env: URL;
  example: URL;
  root: URL;
};

const writeFiles = Bun.argv.includes("--write");
const printPrivateKey = Bun.argv.includes("--print-private") || Bun.argv.includes("--unsafe-print-secret");
const rotateKeys = Bun.argv.includes("--rotate");
const backendRoot = new URL("../", import.meta.url);
const backendEnvPath = new URL("../.env", import.meta.url);
const backendExamplePath = new URL("../.env.example", import.meta.url);
const base64UrlPattern = /^[A-Za-z0-9_-]+$/u;

const backendLocalProductionValues: EnvValues = {
  NODE_ENV: "production",
  CORS_ALLOWED_ORIGINS: "http://localhost:3000,http://localhost:4173,http://localhost:5173,http://127.0.0.1:4173,http://127.0.0.1:5173",
  FRONTEND_DIST_DIR: "../frontend/dist",
  ALLOW_ANONYMOUS_HOUSEHOLD: "false",
  VAPID_SUBJECT: "mailto:local-production@example.invalid",
};

const frontendLocalProductionValues: EnvValues = {
  VITE_API_BASE_URL: "http://localhost:3000",
  VITE_DEV_SERVER_HOST: "",
};

if (!writeFiles) {
  const vapidKeys = await generateVapidKeys();
  const lines = [
    "Generated VAPID public key. Store the private key on the backend only.",
    "",
    `VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`,
  ];

  if (printPrivateKey) {
    lines.push(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);
  } else {
    lines.push("VAPID_PRIVATE_KEY=<hidden; rerun with --print-private only in a private terminal>");
  }

  lines.push(
    `VAPID_SUBJECT=${backendLocalProductionValues.VAPID_SUBJECT}`,
    "",
    "Frontend build-time env:",
    `VITE_VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`,
    "",
    "Run `bun run env:local-production` to safely write ignored backend/frontend env files.",
  );

  console.log(lines.join("\n"));
} else {
  const frontendPaths = await resolveFrontendPaths();
  await assertGitIgnored(backendRoot, ".env", "backend .env");
  await assertGitIgnored(frontendPaths.root, ".env.production.local", "frontend .env.production.local");

  const existingKeys = rotateKeys ? undefined : await readExistingVapidKeys(backendEnvPath);
  const vapidKeys = existingKeys ?? await generateVapidKeys();
  await updateBackendEnv(vapidKeys);
  await updateFrontendEnv(vapidKeys, frontendPaths);

  console.log([
    existingKeys
      ? "Reused existing backend VAPID keys and synced frontend public key."
      : "Generated new local VAPID keys and synced frontend public key.",
    rotateKeys
      ? "Existing local push subscriptions may need to be recreated after rotation."
      : "Pass --rotate to intentionally regenerate local VAPID keys.",
    "",
    "Wrote local production env files:",
    `- ${backendEnvPath.pathname}`,
    `- ${frontendPaths.env.pathname}`,
    "",
    "Next:",
    "1. Run backend migrations and start the backend on http://localhost:3000.",
    "2. Build/preview the frontend; it will call http://localhost:3000/api/*.",
    "3. Keep VAPID_PRIVATE_KEY out of frontend env and source control.",
  ].join("\n"));
}

async function generateVapidKeys(): Promise<VapidKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );

  if (!isCryptoKeyPair(keyPair)) {
    throw new Error("Expected crypto.subtle.generateKey to return a key pair");
  }

  const publicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

  if (typeof privateJwk.d !== "string") {
    throw new Error("Generated private VAPID key is missing JWK d parameter");
  }

  return {
    privateKey: privateJwk.d,
    publicKey: toBase64Url(new Uint8Array(publicKey)),
  };
}

function isCryptoKeyPair(value: CryptoKey | CryptoKeyPair): value is CryptoKeyPair {
  return "privateKey" in value && "publicKey" in value;
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

async function resolveFrontendPaths(): Promise<FrontendEnvPaths> {
  const siblingFrontendRoot = new URL("../../frontend/", import.meta.url);
  const siblingFrontendExamplePath = new URL(".env.example", siblingFrontendRoot);
  if (await Bun.file(siblingFrontendExamplePath).exists()) {
    return {
      env: new URL(".env.production.local", siblingFrontendRoot),
      example: siblingFrontendExamplePath,
      root: siblingFrontendRoot,
    };
  }

  const bundledFrontendRoot = new URL("../frontend/", import.meta.url);
  const bundledFrontendExamplePath = new URL(".env.example", bundledFrontendRoot);
  if (await Bun.file(bundledFrontendExamplePath).exists()) {
    return {
      env: new URL(".env.production.local", bundledFrontendRoot),
      example: bundledFrontendExamplePath,
      root: bundledFrontendRoot,
    };
  }

  throw new Error("Could not find frontend .env.example in ../frontend or ./frontend");
}

async function updateBackendEnv(keys: VapidKeyPair): Promise<void> {
  const seed = await readSeedFile(backendEnvPath, backendExamplePath);
  const nextContent = updateEnvContent(seed, {
    ...backendLocalProductionValues,
    VAPID_PRIVATE_KEY: keys.privateKey,
    VAPID_PUBLIC_KEY: keys.publicKey,
  }, quoteBackendEnvValue);

  await Bun.write(backendEnvPath, nextContent);
}

async function updateFrontendEnv(
  keys: VapidKeyPair,
  paths: FrontendEnvPaths,
): Promise<void> {
  const seed = await readSeedFile(paths.env, paths.example);
  const nextContent = updateEnvContent(seed, {
    ...frontendLocalProductionValues,
    VITE_VAPID_PUBLIC_KEY: keys.publicKey,
  }, quoteFrontendEnvValue);

  await Bun.write(paths.env, nextContent);
}

async function readExistingVapidKeys(envPath: URL): Promise<VapidKeyPair | undefined> {
  if (!await Bun.file(envPath).exists()) {
    return undefined;
  }

  const content = await Bun.file(envPath).text();
  const publicKey = readEnvValue(content, "VAPID_PUBLIC_KEY");
  const privateKey = readEnvValue(content, "VAPID_PRIVATE_KEY");

  if (!publicKey || !privateKey) {
    return undefined;
  }

  const keys = { privateKey, publicKey };
  return isUsableVapidKeyPair(keys) ? keys : undefined;
}

function readEnvValue(content: string, key: string): string | undefined {
  const prefix = `${key}=`;
  for (const line of content.split(/\r?\n/u)) {
    if (line.startsWith(prefix)) {
      return unquoteEnvValue(line.slice(prefix.length));
    }
  }
  return undefined;
}

function unquoteEnvValue(rawValue: string): string {
  const value = rawValue.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "string") {
      throw new Error("Expected quoted env value to parse as a string");
    }
    return parsed;
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

function isUsableVapidKeyPair(keys: VapidKeyPair): boolean {
  return keys.publicKey.length === 87 &&
    keys.privateKey.length >= 40 &&
    keys.privateKey.length <= 64 &&
    base64UrlPattern.test(keys.publicKey) &&
    base64UrlPattern.test(keys.privateKey);
}

async function assertGitIgnored(root: URL, relativePath: string, label: string): Promise<void> {
  const rootPath = fileURLToPath(root);
  const ignoreCheck = Bun.spawnSync({
    cmd: ["git", "check-ignore", "-q", "--", relativePath],
    cwd: rootPath,
    stderr: "pipe",
    stdout: "ignore",
  });

  if (ignoreCheck.exitCode === 0) {
    return;
  }

  const trackedCheck = Bun.spawnSync({
    cmd: ["git", "ls-files", "--error-unmatch", "--", relativePath],
    cwd: rootPath,
    stderr: "ignore",
    stdout: "ignore",
  });

  if (trackedCheck.exitCode === 0) {
    throw new Error(`${label} is tracked by git. Refusing to write secrets.`);
  }

  throw new Error(`${label} is not ignored by git. Add ${relativePath} to .gitignore before writing secrets.`);
}

async function readSeedFile(targetPath: URL, examplePath: URL): Promise<string> {
  if (await Bun.file(targetPath).exists()) {
    return Bun.file(targetPath).text();
  }
  if (await Bun.file(examplePath).exists()) {
    return Bun.file(examplePath).text();
  }
  return "";
}

function updateEnvContent(
  content: string,
  values: EnvValues,
  quoteValue: (value: string) => string,
): string {
  const lines = content.split(/\r?\n/u);
  const seen = new Set<string>();
  const nextLines = lines.map((line) => {
    const keyMatch = /^([A-Za-z_][A-Za-z0-9_]*)=/u.exec(line);
    const key = keyMatch?.[1];
    if (!key) return line;

    const nextValue = values[key];
    if (nextValue === undefined) return line;

    seen.add(key);
    return `${key}=${quoteValue(nextValue)}`;
  });

  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) {
      nextLines.push(`${key}=${quoteValue(value)}`);
    }
  }

  return `${nextLines.join("\n").replace(/\n*$/u, "")}\n`;
}

function quoteBackendEnvValue(value: string): string {
  return JSON.stringify(value);
}

function quoteFrontendEnvValue(value: string): string {
  return value;
}
