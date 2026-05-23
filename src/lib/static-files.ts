import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { createProblem, problemResponse } from "./problem";

const defaultDistRootCandidates = [
  resolve(process.cwd(), "..", "frontend", "dist"),
  resolve(process.cwd(), "frontend", "dist"),
];

const mimeByExtension = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
  [".woff", "font/woff"],
]);

export async function serveStaticOrSpa(request: Request, requestId: string): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname.startsWith("/api/") || pathname === "/api") {
    return problemResponse(createProblem({
      status: 404,
      title: "Not found",
      detail: "API route not found",
      instance: pathname,
      requestId,
    }));
  }

  const relativePath = getSafeRelativePath(pathname);
  if (!relativePath) {
    return notFoundResponse(pathname, requestId);
  }

  if (pathname === "/" || shouldServeSpaFallback(pathname)) {
    return serveFile("index.html", false, requestId, pathname);
  }

  return serveFile(relativePath, true, requestId, pathname);
}

async function serveFile(
  relativePath: string,
  missingIsNotFound: boolean,
  requestId: string,
  pathname: string,
): Promise<Response> {
  const distRoot = await resolveFrontendDistRoot();
  if (!distRoot) {
    return frontendDistMissingResponse(pathname, requestId);
  }

  const filePath = resolve(distRoot, relativePath);
  if (!isPathWithinRoot(filePath, distRoot)) {
    return notFoundResponse(pathname, requestId);
  }

  const file = Bun.file(filePath);
  const exists = await file.exists();

  if (!exists) {
    if (missingIsNotFound) {
      return notFoundResponse(pathname, requestId);
    }
    return notFoundResponse("/index.html", requestId);
  }

  const headers = new Headers({
    "content-type": getContentType(relativePath),
    "cache-control": getCacheControl(relativePath),
    "x-request-id": requestId,
  });
  if (relativePath === "sw.js") {
    headers.set("service-worker-allowed", "/");
  }

  return new Response(file, { headers });
}

async function resolveFrontendDistRoot(): Promise<string | null> {
  for (const candidate of getDistRootCandidates()) {
    if (await Bun.file(join(candidate, "index.html")).exists()) {
      return candidate;
    }
  }
  return null;
}

function getDistRootCandidates(): string[] {
  const configured = resolveConfiguredDistRoot();
  if (!configured) {
    return defaultDistRootCandidates;
  }

  return [
    configured,
    ...defaultDistRootCandidates.filter((candidate) => candidate !== configured),
  ];
}

function resolveConfiguredDistRoot(): string | null {
  const configured = process.env.FRONTEND_DIST_DIR?.trim();
  if (!configured) {
    return null;
  }
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

function isPathWithinRoot(filePath: string, rootPath: string): boolean {
  const rootRelativePath = relative(rootPath, filePath);
  return rootRelativePath === "" || (!rootRelativePath.startsWith("..") && !isAbsolute(rootRelativePath));
}

function shouldServeSpaFallback(pathname: string): boolean {
  if (pathname.startsWith("/assets/")) {
    return false;
  }
  const extension = extname(pathname);
  return extension === "";
}

function getSafeRelativePath(pathname: string): string | null {
  const decoded = safeDecode(pathname);
  if (!decoded) {
    return null;
  }
  const withoutLeadingSlash = decoded.replace(/^\/+/, "");
  const segments = withoutLeadingSlash.split("/");
  if (segments.some((segment) => segment === ".." || segment.includes("\0") || segment.includes("\\"))) {
    return null;
  }
  return withoutLeadingSlash || "index.html";
}

function safeDecode(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch (error) {
    if (error instanceof URIError) {
      return null;
    }
    throw error;
  }
}

function getContentType(relativePath: string): string {
  return mimeByExtension.get(extname(relativePath)) ?? "application/octet-stream";
}

function getCacheControl(relativePath: string): string {
  if (relativePath === "index.html" || relativePath === "sw.js") {
    return "no-cache, no-store, must-revalidate";
  }
  if (relativePath === "manifest.webmanifest") {
    return "no-cache";
  }
  if (relativePath.startsWith("assets/")) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=3600";
}

function notFoundResponse(pathname: string, requestId: string): Response {
  return problemResponse(createProblem({
    status: 404,
    title: "Not found",
    detail: "Static asset not found",
    instance: pathname,
    requestId,
  }));
}

function frontendDistMissingResponse(pathname: string, requestId: string): Response {
  return problemResponse(createProblem({
    status: 404,
    title: "Frontend dist not found",
    detail: "Build the sibling frontend or set FRONTEND_DIST_DIR to the directory containing index.html.",
    instance: pathname,
    requestId,
  }));
}
