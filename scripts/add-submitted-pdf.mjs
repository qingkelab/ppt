import { appendFile, readFile, writeFile } from "node:fs/promises";
import dns from "node:dns/promises";
import path from "node:path";

const allowedTopics = new Set([
  "LLM Infra",
  "Training & Inference",
  "Agent",
  "Model Architecture",
]);

function section(body, heading) {
  const pattern = new RegExp(`### ${heading}\\s*\\n([\\s\\S]*?)(?=\\n### |$)`);
  const match = body.match(pattern);
  return match ? match[1].trim() : "";
}

function isPrivateAddress(address) {
  if (address.includes(":")) {
    const normalized = address.toLowerCase();
    if (normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd")) {
      return true;
    }

    if (
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    ) {
      return true;
    }

    if (normalized.startsWith("::ffff:")) {
      return isPrivateAddress(normalized.slice(7));
    }

    return false;
  }

  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value))) {
    return true;
  }

  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

async function assertPublicHostname(url) {
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("链接指向了非公开地址");
  }
}

async function fetchDocument(url, method) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    return await fetch(url, {
      method,
      redirect: "manual",
      signal: controller.signal,
      headers:
        method === "GET"
          ? { Range: "bytes=0-0", "User-Agent": "qingkelab-ppt-submission" }
          : { "User-Agent": "qingkelab-ppt-submission" },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function inspectUrl(inputUrl) {
  let currentUrl = new URL(inputUrl);

  if (currentUrl.protocol !== "https:") {
    throw new Error("仅支持 https PDF 链接");
  }

  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    await assertPublicHostname(currentUrl);

    let response = await fetchDocument(currentUrl, "HEAD");
    if ([403, 405, 501].includes(response.status)) {
      response = await fetchDocument(currentUrl, "GET");
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirectCount === 5) {
        throw new Error("链接重定向次数过多");
      }

      currentUrl = new URL(location, currentUrl);
      continue;
    }

    if (!response.ok) {
      throw new Error(`PDF 链接返回 HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    const looksLikePdf =
      currentUrl.pathname.toLowerCase().endsWith(".pdf") ||
      contentType.includes("application/pdf") ||
      contentType.includes("application/octet-stream");

    if (!looksLikePdf) {
      throw new Error("链接内容不是 PDF");
    }

    return {
      size: Number(response.headers.get("content-length")) || 0,
      cors: response.headers.get("access-control-allow-origin") || "",
    };
  }

  throw new Error("无法解析 PDF 链接");
}

function safeFileName(url) {
  const rawName = decodeURIComponent(path.basename(url.pathname)) || "document.pdf";
  return rawName
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function fileTitle(fileName) {
  return fileName
    .replace(/\.pdf$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const issueNumber = process.env.ISSUE_NUMBER || "manual";
const issueBody = process.env.ISSUE_BODY || "";
const submittedUrl = section(issueBody, "PDF 链接");
const submittedTitle = section(issueBody, "标题");
const submittedTopics = section(issueBody, "技术主题")
  .split("\n")
  .filter((line) => /^- \[x\]/i.test(line))
  .map((line) => line.replace(/^- \[x\]\s*/i, "").trim())
  .filter((topic) => allowedTopics.has(topic));

if (!submittedUrl) {
  throw new Error("未读取到 PDF 链接");
}

const parsedUrl = new URL(submittedUrl);
const fileName = safeFileName(parsedUrl);
const inspection = await inspectUrl(parsedUrl.toString());
const title =
  submittedTitle && submittedTitle !== "未填写"
    ? submittedTitle
    : fileTitle(fileName);
const viewerUrl =
  inspection.cors === "*" || inspection.cors.includes("qingkelab.github.io")
    ? `https://mozilla.github.io/pdf.js/web/viewer.html?file=${encodeURIComponent(parsedUrl.toString())}`
    : parsedUrl.toString();
const record = {
  path: `external/submissions/issue-${issueNumber}/${fileName}`,
  size: inspection.size,
  title,
  tags: submittedTopics,
  sourceLabel: `${parsedUrl.hostname} · ${fileName}`,
  sourceUrl: parsedUrl.toString(),
  downloadUrl: parsedUrl.toString(),
  viewerUrl,
};

const indexPath = process.env.INDEX_PATH || "index.html";
let source = await readFile(indexPath, "utf8");
const blockPattern = /      const externalDocuments = (\[[\s\S]*?\n      \]);/;
const blockMatch = source.match(blockPattern);

if (!blockMatch) {
  throw new Error("未找到资料索引数组");
}

const externalDocuments = Function(`"use strict"; return (${blockMatch[1]});`)();
const duplicate = externalDocuments.some(
  (document) =>
    document.sourceUrl === record.sourceUrl ||
    document.downloadUrl === record.downloadUrl,
);

if (!duplicate) {
  externalDocuments.push(record);
  const serialized = JSON.stringify(externalDocuments, null, 2).replace(
    /\n/g,
    "\n      ",
  );
  const replacement = `      const externalDocuments = ${serialized};`;
  source = source.replace(blockPattern, replacement);

  if (process.env.DRY_RUN !== "1") {
    await writeFile(indexPath, source);
  }
}

if (process.env.GITHUB_OUTPUT) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `title=${title.replaceAll("\n", " ")}\nduplicate=${duplicate}\n`,
  );
}

console.log(
  JSON.stringify({ added: !duplicate, title, sourceUrl: record.sourceUrl }),
);
