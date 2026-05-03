import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, "..");
const outDir = path.join(workspace, "dashboard");
const outFile = path.join(outDir, "index.html");
const ignoredDirs = new Set([".git", ".obsidian", "dashboard", "templates", "skill", "references", "node_modules", "_archive", ".hireable"]);

function parseScalar(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed === "[]") return [];
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  if (/^\[.*\]$/.test(trimmed)) {
    return trimmed.slice(1, -1).split(",").map((item) => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  }
  return trimmed.replace(/^["']|["']$/g, "");
}

function parseFrontmatter(markdown) {
  if (!markdown.startsWith("---\n")) return {};
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) return {};
  const data = {};
  let currentKey = null;

  for (const line of markdown.slice(4, end).split("\n")) {
    if (!line.trim()) continue;
    const listMatch = line.match(/^\s+-\s+(.*)$/);
    if (listMatch && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(parseScalar(listMatch[1]));
      continue;
    }
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) continue;
    const [, key, value] = pair;
    currentKey = key;
    data[key] = value === "" ? "" : parseScalar(value);
  }

  return data;
}

async function walk(dir, extensions) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) files.push(...(await walk(full, extensions)));
    } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(full);
    }
  }
  return files;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeJson(value) {
  return JSON.stringify(value).replaceAll("</", "<\\/");
}

function formatStatus(status) {
  return String(status || "unknown").replaceAll("_", " ");
}

function statusClass(status) {
  return String(status || "unknown").replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
}

function latestEventDate(events) {
  if (!Array.isArray(events)) return "";
  return events
    .map((event) => {
      if (typeof event === "string") return event.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
      if (event && typeof event === "object") return event.date ?? "";
      return "";
    })
    .filter(Boolean)
    .sort()
    .at(-1) ?? "";
}

function isDue(date) {
  if (!date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const candidate = new Date(`${date}T00:00:00`);
  return !Number.isNaN(candidate.valueOf()) && candidate <= today;
}

function stageForStatus(status) {
  const value = String(status || "").toLowerCase();
  if (["lead", "qualified"].includes(value)) return "lead";
  if (["to_apply", "drafting", "ready_to_apply"].includes(value)) return "application";
  if (["offer", "negotiation"].includes(value)) return "offer";
  if (value === "accepted") return "landed";
  if (["rejected", "declined", "archived"].includes(value)) return "archive";
  // Default: any other status (applied / intro / recruiter / screen / interview /
  // takehome / final / non-canonical labels like "in process") is an active pipeline thread.
  return "pipeline";
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function buildActivityDays(jobs) {
  const counts = new Map();
  for (const job of jobs) {
    const date = job.latestEvent || job.nextActionDate || job.lastInteraction;
    if (date) counts.set(date, (counts.get(date) || 0) + 1);
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(today.getDate() - 111);

  return Array.from({ length: 112 }, (_, index) => {
    const current = new Date(start);
    current.setDate(start.getDate() + index);
    const key = dateKey(current);
    const count = counts.get(key) || 0;
    return { date: key, count, level: Math.min(4, count) };
  });
}

function channelStatus(profile) {
  const names = ["Email", "LinkedIn", "Telegram", "Discord", "Calendar", "Phone / SMS", "Other"];
  return names.map((name) => {
    const match = profile.match(new RegExp(`^- ${name.replace("/", "\\/")}:\\s*(.*)$`, "mi"));
    const value = match?.[1]?.trim() || "";
    return { name, value, connected: /\bconnected\b/i.test(value), manual: /\bmanual\b/i.test(value) };
  });
}

// Setup gaps are ONLY the things that genuinely block the agent from doing
// useful work. Positioning, hired-by date, comp floor — those are refinements
// that surface in conversation; they are not setup gaps.
function setupGaps(profile, resumePdfs) {
  const channels = channelStatus(profile);
  const gaps = [];
  if (!resumePdfs.length) gaps.push("Master resume not yet in workspace");
  if (!channels.some((channel) => channel.connected || channel.manual)) {
    gaps.push("No comms channel set up");
  }
  return { channels, gaps };
}

function currentStageKey({ setup, jobs, dueJobs }) {
  if (setup.gaps.length) return "setup";
  if (jobs.some((job) => ["offer", "negotiation"].includes(String(job.status)))) return "offer";
  if (dueJobs.length) return "follow_up";
  if (jobs.some((job) => ["applied", "intro", "recruiter", "screen", "interview", "takehome", "final"].includes(String(job.status)))) return "pipeline";
  if (jobs.some((job) => ["to_apply", "drafting", "ready_to_apply"].includes(String(job.status)))) return "application";
  return "positioning";
}

function handoffPrompt(stage, setup, dueJobs) {
  // The goalpost framing: this prompt tells the agent which stage of the
  // job-search journey the user has reached and which threads are open.
  // It does NOT tell the agent what to do next — SKILL.md does that, and the
  // user's actual conversation in this turn does the rest.
  const openThreads = [
    ...setup.gaps.map((gap) => `  - ${gap}`),
    ...(dueJobs.length ? [`  - ${dueJobs.length} opportunit${dueJobs.length === 1 ? "y" : "ies"} need follow-up action`] : []),
  ];
  const threadBlock = openThreads.length
    ? `Open threads at this goalpost:\n${openThreads.join("\n")}`
    : "No open threads detected at this goalpost.";

  return `Run /skill hireable.

Read SKILL.md before doing anything else — it defines how this skill operates.
Then read profile.md, targets.md, and any job notes relevant to the user's
current message.

The user has reached this goalpost: ${stage.label}.
${threadBlock}

These are conversations to have with the user, not tasks to execute on their
behalf. Each user runs their job search differently — your job is to walk them
through the goalposts in the way that fits how *they* want to work.

Hard rules:
- Never fabricate. Every name, date, metric, resume bullet, or message draft
  comes from the user, from a workspace file you have read, or from a
  connected channel you have read this session. Empty is fine; placeholder
  content is a bug.
- Ask one plain-English question at a time and wait for the answer. No
  multi-question forms, no "are you ready to proceed."
- Persist durable updates to Markdown. Regenerate the dashboard after
  meaningful changes.
- Don't impose a cadence. Infer urgency from the user's hired-by date and
  active threads, not from a schedule.`;
}

function relHref(file) {
  return path.relative(outDir, file).split(path.sep).map(encodeURIComponent).join("/");
}

function fileHref(file) {
  return "file://" + file.split("/").map(encodeURIComponent).join("/");
}

function stripFrontmatter(markdown) {
  if (!markdown.startsWith("---\n")) return markdown;
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) return markdown;
  return markdown.slice(end + 4).replace(/^\n+/, "");
}

function renderMarkdown(md) {
  const escape = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const inline = (s) =>
    escape(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      // Bold: allow single asterisks inside (e.g. **Email*:**) — only ** pairs close the run.
      .replace(/\*\*((?:[^*]|\*(?!\*))+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  const lines = md.split("\n");
  const out = [];
  let inList = null;
  let inCode = false;
  let paraBuf = [];

  const flushPara = () => {
    if (paraBuf.length) {
      out.push("<p>" + paraBuf.map(inline).join("<br>") + "</p>");
      paraBuf = [];
    }
  };
  const closeList = () => { if (inList) { out.push(`</${inList}>`); inList = null; } };

  for (const raw of lines) {
    if (inCode) {
      if (raw.trim().startsWith("```")) { out.push("</code></pre>"); inCode = false; }
      else out.push(escape(raw));
      continue;
    }
    const line = raw.trim();
    if (line.startsWith("```")) { flushPara(); closeList(); out.push("<pre><code>"); inCode = true; continue; }
    if (!line) { flushPara(); closeList(); continue; }
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) { flushPara(); closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    if (/^-{3,}$/.test(line)) { flushPara(); closeList(); out.push("<hr>"); continue; }
    const ul = line.match(/^[-*]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (inList !== "ul") { closeList(); out.push("<ul>"); inList = "ul"; }
      const task = ul[1].match(/^\[([ xX])\]\s+(.*)$/);
      if (task) {
        const checked = task[1].toLowerCase() === "x";
        out.push(`<li class="task${checked ? " done" : ""}"><span class="task-box" aria-hidden="true"></span><span class="task-label">${inline(task[2])}</span></li>`);
      } else {
        out.push(`<li>${inline(ul[1])}</li>`);
      }
      continue;
    }
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ol) { flushPara(); if (inList !== "ol") { closeList(); out.push("<ol>"); inList = "ol"; } out.push(`<li>${inline(ol[1])}</li>`); continue; }
    if (line.startsWith(">")) { flushPara(); closeList(); out.push(`<blockquote>${inline(line.slice(1).trim())}</blockquote>`); continue; }
    paraBuf.push(line);
  }
  flushPara(); closeList();
  if (inCode) out.push("</code></pre>");
  return out.join("\n");
}

function daysSince(date) {
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const candidate = new Date(`${date}T00:00:00`);
  if (Number.isNaN(candidate.valueOf())) return null;
  return Math.floor((today - candidate) / 86_400_000);
}

function formatRelativeDate(dateStr) {
  if (!dateStr) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(target.valueOf())) return dateStr;
  const days = Math.floor((today - target) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days <= 6) return `${days} days ago`;
  if (days === -1) return "Tomorrow";
  if (days < -1 && days >= -6) return `In ${-days} days`;
  const month = target.toLocaleString("en-US", { month: "short" });
  const day = target.getDate();
  if (target.getFullYear() === today.getFullYear()) return `${month} ${day}`;
  return `${month} ${day}, ${target.getFullYear()}`;
}

function stripHtmlTags(html) {
  return html.replace(/<[^>]+>/g, "");
}

function decodeBasicEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Renders <li><strong>Label:</strong> Value</li> items as copy-able chip buttons.
// Parse a list item like <li><strong>Label:</strong> Value</li> into its parts.
function parseBriefField(liInner) {
  const fieldRe = /^<strong>([^<]*?):?\s*<\/strong>\s*([\s\S]*)$/;
  const field = liInner.match(fieldRe);
  if (!field) return null;
  const label = field[1].trim().replace(/\*+$/, "").trim();
  const valueHtml = field[2].trim();
  const valueText = decodeBasicEntities(stripHtmlTags(valueHtml)).trim();
  // Capture the bare key only — anything after a non-word character (em-dash,
  // hyphen, space, etc.) is treated as inline commentary the agent left in.
  const needMatch = valueText.match(/^\[needs:([A-Za-z0-9_]+)/);
  const isNeed = !!needMatch;
  const isEmpty = !valueText || valueText === "—" || valueText === "-";
  return { label, valueHtml, valueText, isNeed, isEmpty, needKey: isNeed ? needMatch[1] : "" };
}

// Build a single bulk prompt the user can paste into a hireable thread to fill
// every unfilled field in one back-and-forth. The agent batches identity /
// logistics, slows down on essays, and skips time-dependent fields when
// appropriate.
function buildBulkFillPrompt(needs) {
  if (!needs.length) return "";
  const fields = needs.filter((n) => !n.isEssay);
  const essays = needs.filter((n) => n.isEssay);
  const lines = [];
  lines.push("Run the hireable skill. My Application brief has unfilled fields. Help me fill them in profile.md and references/application-answers.md so future briefs use them automatically.");
  lines.push("");
  if (fields.length) {
    lines.push("Unfilled identity / logistics — **batch these**: list 3–5 short questions at a time, accept batched answers, save to profile.md, mirror to references/application-answers.md where applicable.");
    fields.forEach((f) => { lines.push(`  - ${f.label} (\`${f.key}\`)`); });
    lines.push("");
  }
  if (essays.length) {
    lines.push("Unfilled essays — **slow down**: these should sound like me. For each, ask 2–3 short clarifying questions about voice / tone / length first; don't draft on the first pass. Save to references/application-answers.md under the listed key.");
    essays.forEach((e) => { lines.push(`  - ${e.label} (\`${e.key}\`)`); });
    lines.push("");
  }
  lines.push("Skip any field that's time-dependent (e.g. `earliest_start`) if you think it isn't worth caching — those fill best at submission, not pre-emptively.");
  lines.push("");
  lines.push("Once we're done, suggest I run `/hireable-autofill <slug>` to refresh the brief.");
  return lines.join("\n");
}

// Walk the parsed brief content and collect every [needs:] field with its
// label, key, and whether it's in the Short essays section.
function collectNeedsFromInner(innerHtml) {
  const sectionRe = /<h3>([^<]+)<\/h3>([\s\S]*?)(?=<h3>|$)/gi;
  const needs = [];
  let used = false;
  let sec;
  while ((sec = sectionRe.exec(innerHtml)) !== null) {
    used = true;
    const isEssays = isEssaysSectionLabel(sec[1].trim());
    const liHtml = extractLisFromSection(sec[2]);
    if (!liHtml) continue;
    const liRe = /<li>([\s\S]*?)<\/li>/gi;
    let m;
    while ((m = liRe.exec(liHtml)) !== null) {
      const f = parseBriefField(m[1].trim());
      if (f && f.isNeed) needs.push({ key: f.needKey, label: f.label, isEssay: isEssays });
    }
  }
  if (!used) {
    const liHtml = extractLisFromSection(innerHtml);
    if (liHtml) {
      const liRe = /<li>([\s\S]*?)<\/li>/gi;
      let m;
      while ((m = liRe.exec(liHtml)) !== null) {
        const f = parseBriefField(m[1].trim());
        if (f && f.isNeed) needs.push({ key: f.needKey, label: f.label, isEssay: false });
      }
    }
  }
  return needs;
}

// Compact chips for short identity / logistics fields.
function renderChipsFromLis(liHtml) {
  const liRe = /<li>([\s\S]*?)<\/li>/gi;
  const chips = [];
  let m;
  while ((m = liRe.exec(liHtml)) !== null) {
    const f = parseBriefField(m[1].trim());
    if (!f) continue;
    let cls = "brief-chip";
    let display;
    let titleAttr = "";
    let copyAttr = "";
    let tag = "button";
    if (f.isNeed) {
      cls += " needs";
      display = '<span class="brief-value muted">—</span>';
      titleAttr = ` title="Missing — use the 'Copy fill-in prompt' button above to fill this and other unfilled fields"`;
      tag = "div";
    } else if (f.isEmpty) {
      cls += " empty";
      display = '<span class="brief-value muted">—</span>';
      tag = "div";
    } else {
      display = `<span class="brief-value">${f.valueHtml}</span>`;
      copyAttr = ` data-brief-copy="${escapeHtml(f.valueText)}"`;
    }
    const typeAttr = tag === "button" ? ' type="button"' : "";
    chips.push(
      `<${tag}${typeAttr} class="${cls}"${copyAttr}${titleAttr}><span class="brief-label">${escapeHtml(f.label)}</span>${display}</${tag}>`
    );
  }
  return chips.join("");
}

// Stacked cards for paragraph-length essay answers — full text visible.
function renderEssaysFromLis(liHtml) {
  const liRe = /<li>([\s\S]*?)<\/li>/gi;
  const cards = [];
  let m;
  while ((m = liRe.exec(liHtml)) !== null) {
    const f = parseBriefField(m[1].trim());
    if (!f) continue;
    let cls = "brief-essay";
    let body;
    let copyAttr = "";
    let tag = "button";
    if (f.isNeed) {
      cls += " needs";
      body = `<div class="brief-essay-value muted">Not yet written. Use the <strong>Copy fill-in prompt</strong> button at the top of the brief to capture this and other unfilled fields. Will save to <code>references/application-answers.md</code> under <code>${escapeHtml(f.needKey)}</code>.</div>`;
      tag = "div";
    } else if (f.isEmpty) {
      cls += " empty";
      body = `<div class="brief-essay-value muted">—</div>`;
      tag = "div";
    } else {
      body = `<div class="brief-essay-value">${f.valueHtml}</div>`;
      copyAttr = ` data-brief-copy="${escapeHtml(f.valueText)}"`;
    }
    const typeAttr = tag === "button" ? ' type="button"' : "";
    const copyHint = tag === "button"
      ? `<span class="brief-essay-copy-hint">Click to copy</span>`
      : "";
    cards.push(
      `<${tag}${typeAttr} class="${cls}"${copyAttr}><div class="brief-essay-header"><span class="brief-essay-label">${escapeHtml(f.label)}</span>${copyHint}</div>${body}</${tag}>`
    );
  }
  return cards.join("");
}

// Defensive fallback: if the agent wrote a key/value block as a markdown table
// instead of a list (the playbook forbids this but Sonnet has been observed to
// do it), convert the rendered <table> rows into <li><strong>Label:</strong>
// Value</li> form so the rest of the rendering pipeline works. Only the first
// two columns are used — extra columns (like "Required") are ignored.
//
// Returns "" if the table doesn't look like a key/value block (any row has 4+
// cells), so wide data tables are left alone.
function tableToLiHtml(tableHtml) {
  if (!tableHtml) return "";
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = trRe.exec(tableHtml)) !== null) rows.push(row[1]);
  if (!rows.length) return "";
  const lis = [];
  for (const rowInner of rows) {
    if (/<th[\s>]/i.test(rowInner)) continue;
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells = [];
    let c;
    while ((c = cellRe.exec(rowInner)) !== null) cells.push(c[1].trim());
    if (cells.length < 2) continue;
    if (cells.length > 3) return ""; // wide data table — don't mangle
    const label = stripHtmlTags(cells[0]).trim();
    const valueHtml = cells[1];
    if (!label) continue;
    lis.push(`<li><strong>${escapeHtml(label)}:</strong> ${valueHtml}</li>`);
  }
  return lis.join("");
}

// Globally rewrite <table> blocks that look like key/value pairs into <ul>
// blocks. Lets event-card metadata, snapshot blocks, and briefs all benefit
// from the same defensive conversion. Wide data tables (>3 columns) pass
// through untouched because tableToLiHtml returns "" for them.
function convertKvTablesToLists(html) {
  if (!html) return html;
  return html.replace(/<table[\s\S]*?<\/table>/gi, (match) => {
    const lis = tableToLiHtml(match);
    return lis ? `<ul>${lis}</ul>` : match;
  });
}

// Pull the first <ul> from a section, or fall back to converting a <table>.
// (Kept as defense-in-depth even after the global table→list pass.)
function extractLisFromSection(sectionHtml) {
  const ul = sectionHtml.match(/<ul>([\s\S]*?)<\/ul>/i);
  if (ul) return ul[1];
  const table = sectionHtml.match(/<table[\s\S]*?<\/table>/i);
  if (table) return tableToLiHtml(table[0]);
  return "";
}

function isEssaysSectionLabel(label) {
  if (!label) return false;
  const t = label.trim().toLowerCase();
  if (/^short essays?$|^essays?$/.test(t)) return true;
  // Cover-letter-shaped sections render as essays so paragraph-length values
  // are visible, not truncated to a single chip line.
  return /cover letter|additional information|written response|written answer/.test(t);
}

// Inner brief HTML can be either:
//   <h3>Identity</h3><ul>...</ul><h3>Logistics</h3><ul>...</ul>
// or a flat <ul>...</ul>. Render each section as its own group; essays get
// stacked-card layout, everything else gets compact chips.
function renderBriefChips(innerHtml) {
  const sectionRe = /<h3>([^<]+)<\/h3>([\s\S]*?)(?=<h3>|$)/gi;
  const sections = [];
  let used = false;
  let m;
  while ((m = sectionRe.exec(innerHtml)) !== null) {
    used = true;
    const liHtml = extractLisFromSection(m[2]);
    if (!liHtml) continue;
    sections.push({ label: m[1].trim(), liHtml });
  }
  if (!used) {
    const liHtml = extractLisFromSection(innerHtml);
    if (liHtml) sections.push({ label: "", liHtml });
  }
  if (!sections.length) return "";
  return sections
    .map((sec) => {
      const isEssays = isEssaysSectionLabel(sec.label);
      const inner = isEssays ? renderEssaysFromLis(sec.liHtml) : renderChipsFromLis(sec.liHtml);
      if (!inner) return "";
      const heading = sec.label
        ? `<h4 class="brief-section-label">${escapeHtml(sec.label)}</h4>`
        : "";
      const containerCls = isEssays ? "brief-essays" : "brief-chips";
      return `<div class="brief-section${isEssays ? " is-essays" : ""}">${heading}<div class="${containerCls}">${inner}</div></div>`;
    })
    .join("");
}

// Pull "## Application brief" out of the body and re-render as a chip surface.
// Returns { briefBlock, withoutBrief } — caller prepends briefBlock so the
// surface always pins to the top of the job detail, regardless of where the
// user wrote it in the markdown.
function countBriefChips(chipHtml) {
  const totalChips = (chipHtml.match(/class="brief-chip[^"]*"/g) || []).length;
  const totalEssays = (chipHtml.match(/class="brief-essay[^"]*"/g) || []).length;
  const total = totalChips + totalEssays;
  const needs = (chipHtml.match(/class="brief-(?:chip|essay) needs"/g) || []).length;
  const empty = (chipHtml.match(/class="brief-(?:chip|essay) empty"/g) || []).length;
  const ready = total - needs - empty;
  return { total, ready, needs, empty };
}

function extractApplicationBrief(html) {
  const re = /<h2>\s*Application brief\s*<\/h2>([\s\S]*?)(?=<h2[\s>]|$)/i;
  const match = html.match(re);
  if (!match) return { briefBlock: "", withoutBrief: html };
  const inner = match[1];
  const chips = renderBriefChips(inner);
  if (!chips) return { briefBlock: "", withoutBrief: html.replace(match[0], "") };
  const counts = countBriefChips(chips);
  const summaryBits = [];
  if (counts.ready) summaryBits.push(`${counts.ready} ready`);
  if (counts.needs) summaryBits.push(`${counts.needs} needs`);
  if (counts.empty) summaryBits.push(`${counts.empty} empty`);
  const summary = summaryBits.length ? summaryBits.join(" · ") : `${counts.total} fields`;

  const needs = collectNeedsFromInner(inner);
  const bulkPrompt = buildBulkFillPrompt(needs);
  const bulkBar = bulkPrompt
    ? `<div class="brief-bulk-bar"><button type="button" class="brief-bulk-fill" data-brief-copy="${escapeHtml(bulkPrompt)}" title="Copy a prompt that fills all ${needs.length} unfilled fields in one back-and-forth with your hireable agent">Copy fill-in prompt</button></div>`
    : "";

  const briefBlock = `<details class="application-brief"><summary class="brief-summary"><span class="brief-summary-label">Application brief</span><span class="brief-summary-counts">${summary}</span><span class="brief-summary-chevron" aria-hidden="true">›</span></summary><div class="brief-body">${bulkBar}${chips}</div></details>`;
  const withoutBrief = html.replace(match[0], "");
  return { briefBlock, withoutBrief };
}

function postProcessJobBody(html) {
  if (!html) return html;
  html = convertKvTablesToLists(html);
  const { briefBlock, withoutBrief } = extractApplicationBrief(html);
  let out = withoutBrief;
  // Replace ISO dates inside <h2> headings with relative dates.
  out = out.replace(/<h2>\s*(\d{4}-\d{2}-\d{2})\s*([—\-])\s*([\s\S]*?)<\/h2>/g,
    (_, date, sep, rest) => {
      const rel = formatRelativeDate(date);
      return `<h2><span class="event-date">${rel}</span><span class="event-sep"> ${sep} </span><span class="event-title">${rest}</span></h2>`;
    });
  // Wrap each h2 + following content (up to next h2) in an event-card.
  let cardsHtml = out;
  if (/<h2/.test(out)) {
    const parts = out.split(/(?=<h2[\s>])/);
    const head = parts[0];
    const cards = parts.slice(1);
    if (cards.length) {
      const wrapped = cards.map((segment, i) => {
        const isLast = i === cards.length - 1;
        return `<div class="event-card${isLast ? " current" : ""}">${segment}</div>`;
      }).join("");
      cardsHtml = head + wrapped;
    }
  }
  return briefBlock + cardsHtml;
}

function jobLabel(job) {
  if (job.company && job.role) return `${job.company} (${job.role})`;
  return job.company || job.role || job.name.replace(/\.md$/, "");
}

const SETUP_NUDGES = {
  "Master resume not yet in workspace": "add your master resume",
  "No comms channel set up": "pick a comms channel — connect one (Gmail, Slack, etc.) or tell me you'll paste messages manually",
};

function formatList(items) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function extractFirstName(profile, primaryResume) {
  const fm = parseFrontmatter(profile);
  if (fm.name && typeof fm.name === "string") {
    const trimmed = fm.name.trim();
    if (trimmed) return trimmed.split(/\s+/)[0];
  }
  if (primaryResume) {
    const cleaned = path.basename(primaryResume)
      .replace(/^\d+[-_]/, "")
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " ")
      .replace(/\b(resume|cv|master|copy|final|draft|v\d+)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned) return cleaned.split(/\s+/)[0];
  }
  return "";
}

const ITEM_PROMPTS = {
  "Master resume in workspace":
    "Run the hireable skill. Help me get my master resume into the workspace — ask if I have a file to attach, a path I can point you at, or if you should help me build one from scratch.",
  "Comms channel chosen (connected or manual)":
    "Run the hireable skill. Help me set up my comms channels: list which inbound MCPs are available in this session, ask which I want to use for tracking job-search messages, and record the choices in profile.md.",
  "One-line pitch drafted":
    "Run the hireable skill. Read my master resume and help me draft a one-line pitch. Ask what kinds of roles I'm targeting, propose two or three options I can react to, then save the chosen one to profile.md under Positioning › One-line pitch.",
  "Strengths and proof points":
    "Run the hireable skill. Read my master resume and help me articulate three to five strengths with a concrete proof point for each. Ask clarifying questions if anything is unclear, then save the result to profile.md under Positioning › Strengths and Proof Points.",
  "Reusable stories":
    "Run the hireable skill. Help me draft three to five reusable stories from my work history that I can use in interviews, cover letters, and intro messages. Ask which experiences feel strongest first, then save the stories to profile.md under Positioning › Stories To Reuse.",
  "Hired-by date set":
    "Run the hireable skill. Help me set a target hired-by date — ask about my runway, urgency, and any external timing. Save the result in profile.md under Constraints › Intended hired-by date.",
};

function checkItem(label, done) {
  return { kind: "check", done, label };
}

function buildStagePrompt({ stage, items, jobs, dueJobs }) {
  const incomplete = items.filter((i) => i.kind === "check" && !i.done).map((i) => i.label);
  const fmtList = (arr) => arr.join("; ");

  switch (stage.key) {
    case "setup": {
      if (!incomplete.length) {
        return "Run the hireable skill. My Setup section is already in place. Walk through it with me to confirm nothing important is missed before I move on.";
      }
      return `Run the hireable skill. Help me finish the Setup section of my workspace. Currently incomplete: ${fmtList(incomplete)}. Walk me through fixing each one and update profile.md as we go.`;
    }
    case "positioning": {
      if (!incomplete.length) {
        return "Run the hireable skill. My Positioning section is filled in. Read profile.md and my master resume, then suggest anything that could be sharper.";
      }
      return `Run the hireable skill. Help me complete the Positioning section of my profile. Currently incomplete: ${fmtList(incomplete)}. Read my master resume first, then walk me through each, and save the result to profile.md.`;
    }
    case "application": {
      const queued = jobs.filter((j) => ["to_apply", "drafting", "ready_to_apply"].includes(String(j.status)));
      if (!queued.length) {
        return "Run the hireable skill. My Apply queue is empty. Help me think through which roles to look at next and how to add the right ones to the pipeline.";
      }
      const names = queued.map((j) => j.company || j.name.replace(/\.md$/i, "")).join(", ");
      return `Run the hireable skill. Help me move my Apply queue forward. I have ${queued.length} role${queued.length === 1 ? "" : "s"} queued: ${names}. Walk me through tailoring materials and submitting each, one at a time.`;
    }
    case "pipeline": {
      const active = jobs.filter((j) => ["applied", "intro", "recruiter", "screen", "interview", "takehome", "final"].includes(String(j.status)));
      if (!active.length) {
        return "Run the hireable skill. My Pipeline is empty right now. Help me think about how to grow it intentionally without spreading too thin.";
      }
      return `Run the hireable skill. Help me review my Pipeline. I have ${active.length} active thread${active.length === 1 ? "" : "s"}. Walk me through which are progressing, which are stale, and what to do for each.`;
    }
    case "follow_up": {
      if (!dueJobs.length) {
        return "Run the hireable skill. Nothing in my pipeline is overdue right now. Sanity-check that with me — review threads and tell me if anything needs attention I'm not seeing.";
      }
      return `Run the hireable skill. Help me work through my Follow-up section. ${dueJobs.length} thread${dueJobs.length === 1 ? "" : "s"} need${dueJobs.length === 1 ? "s" : ""} a next action. Walk me through each, including drafting any messages.`;
    }
    case "offer": {
      const offers = jobs.filter((j) => ["offer", "negotiation"].includes(String(j.status)));
      if (!offers.length) {
        return "Run the hireable skill. I don't have any active offers yet. Help me think about my evaluation criteria — what would make a yes vs. a no when one comes.";
      }
      const names = offers.map((j) => j.company || j.name.replace(/\.md$/i, "")).join(", ");
      return `Run the hireable skill. Help me with my Offer section. I have ${offers.length} active offer${offers.length === 1 ? "" : ""}: ${names}. Walk me through comparing, negotiating, and deciding.`;
    }
    default:
      return "";
  }
}

function jobLine(job) {
  const company = job.company || job.name.replace(/\.md$/i, "");
  if (job.role) return `${company} — ${job.role}`;
  return company;
}

function buildStageItems({ profile, jobs, dueJobs, setup, primaryResume }) {
  const out = { setup: [], positioning: [], application: [], pipeline: [], follow_up: [], offer: [] };

  // Setup: real prerequisites.
  out.setup.push(checkItem("Master resume in workspace", !!primaryResume));
  out.setup.push(checkItem(
    "Comms channel chosen (connected or manual)",
    setup.channels.some((c) => c.connected || c.manual),
  ));

  // Positioning: derived from profile.md.
  out.positioning.push(checkItem("One-line pitch drafted", !/One-line pitch\s*\n+\s*TODO/i.test(profile)));
  out.positioning.push(checkItem("Strengths and proof points", !/Strengths\s*\n+\s*-\s*TODO/i.test(profile)));
  out.positioning.push(checkItem("Reusable stories", !/Stories To Reuse\s*\n+\s*-\s*TODO/i.test(profile)));
  out.positioning.push(checkItem("Hired-by date set", !/Intended hired-by date:\s*$/m.test(profile)));

  const cap = (list, max = 5) => {
    const head = list.slice(0, max).map((j) => ({ kind: "list", label: jobLine(j), date: j.nextActionDate || j.latestEvent || "" }));
    if (list.length > max) head.push({ kind: "list", label: `+ ${list.length - max} more in the table below`, muted: true });
    return head;
  };

  out.application = cap(jobs.filter((j) => ["to_apply", "drafting", "ready_to_apply"].includes(String(j.status))));
  out.pipeline = cap(jobs.filter((j) => ["applied", "intro", "recruiter", "screen", "interview", "takehome", "final"].includes(String(j.status))));
  out.follow_up = cap(dueJobs);
  out.offer = cap(jobs.filter((j) => ["offer", "negotiation"].includes(String(j.status))));

  return out;
}

function buildPrompt({ name, setup, jobs, dueJobs, primaryResume, agent }) {
  const hi = name ? `Hey ${name}` : "Hey there";
  const ref = agent || "your agent";

  // No master resume yet.
  if (!primaryResume) {
    return {
      greeting: `${hi}.`,
      body: `First step is your master resume. Ask ${ref} to set one up — attach a file you have, point at one on your machine, or build one together from scratch.`,
    };
  }

  // Resume in, other setup gaps remain.
  if (setup.gaps.length) {
    const items = setup.gaps.map((gap) => SETUP_NUDGES[gap]).filter(Boolean);
    return {
      greeting: `${hi} — your resume is in. That's the foundation.`,
      body: items.length
        ? `Next, ask ${ref} to help with: ${formatList(items)}.`
        : `When you're ready, paste a job listing into ${ref} and it'll start tracking it.`,
    };
  }

  // Setup complete, pipeline empty.
  if (!jobs.length) {
    return {
      greeting: `${hi} — you're all set up.`,
      body: `Paste a job listing or URL into ${ref} and it'll start tracking it for you.`,
    };
  }

  // Operating mode.
  const total = jobs.length;
  const due = dueJobs.length;
  return {
    greeting: `${hi} — ${total} thread${total === 1 ? "" : "s"} in your pipeline.`,
    body: due > 0
      ? `${due} need${due === 1 ? "s" : ""} a next action. Ask ${ref} about any of them, or paste a new role.`
      : `Nothing overdue. Ask ${ref} about any of them, or paste a new role.`,
  };
}

function buildNarrative({ profile, setup, jobs, dueJobs, activeJobs }) {
  const paragraphs = [];

  // Setup gaps are surfaced via "Try this next" — not duplicated as prose.

  const recent = [...jobs]
    .map((job) => ({ job, when: job.latestEvent || job.lastInteraction }))
    .filter((entry) => entry.when)
    .sort((a, b) => String(b.when).localeCompare(String(a.when)))
    .slice(0, 2);

  const interview = jobs.filter((job) => ["screen", "interview", "takehome", "final"].includes(String(job.status)));
  const offer = jobs.filter((job) => ["offer", "negotiation"].includes(String(job.status)));

  const staleStatuses = new Set(["intro", "recruiter", "screen"]);
  const stale = activeJobs
    .filter((job) => staleStatuses.has(String(job.status)))
    .map((job) => ({ job, days: daysSince(job.latestEvent || job.lastInteraction) }))
    .filter((entry) => entry.days === null || entry.days >= 7)
    .sort((a, b) => (b.days ?? 999) - (a.days ?? 999))
    .slice(0, 3);

  const sentences = [];

  if (offer.length) {
    sentences.push(`There ${offer.length === 1 ? "is" : "are"} ${offer.length} live offer${offer.length === 1 ? "" : "s"} (${offer.map(jobLabel).join(", ")}) — that's the priority.`);
  }

  if (interview.length) {
    sentences.push(`${interview.length === 1 ? "One role is" : `${interview.length} roles are`} in interview: ${interview.map(jobLabel).join(", ")}.`);
  }

  if (recent.length) {
    const parts = recent.map(({ job, when }) => `${jobLabel(job)} on ${when}`);
    sentences.push(`Most recent movement was ${parts.join(", then ")}.`);
  }

  if (stale.length) {
    const parts = stale.map(({ job, days }) => `${job.company || jobLabel(job)}${days != null ? ` (${days}d)` : ""}`);
    sentences.push(`Stale conversations worth a nudge: ${parts.join(", ")}.`);
  }

  if (dueJobs.length) {
    sentences.push(`${dueJobs.length} thread${dueJobs.length === 1 ? "" : "s"} are missing a next action — most are post-application with no recruiter reply yet.`);
  } else if (!setup.gaps.length) {
    sentences.push(`Nothing is overdue. Worth using the spare cycles on the highest-fit leads or sharpening the master pitch.`);
  }

  if (sentences.length) {
    const half = Math.ceil(sentences.length / 2);
    paragraphs.push(sentences.slice(0, half).join(" "));
    const tail = sentences.slice(half).join(" ");
    if (tail) paragraphs.push(tail);
  }

  if (!paragraphs.length) {
    paragraphs.push("Nothing to flag right now.");
  }

  return paragraphs;
}


async function main() {
  const markdownFiles = await walk(workspace, new Set([".md", ".mdx"]));
  const resumesDir = path.join(workspace, "resumes");
  const resumePdfs = (await walk(workspace, new Set([".pdf"])))
    .filter((file) => file.startsWith(resumesDir + path.sep) || /resume|cv|master/i.test(path.basename(file)));
  // Promote master.* to primary; sort the rest alphabetically by filename.
  resumePdfs.sort((a, b) => {
    const isMaster = (f) => /^master\b/i.test(path.basename(f));
    if (isMaster(a) && !isMaster(b)) return -1;
    if (!isMaster(a) && isMaster(b)) return 1;
    return path.basename(a).localeCompare(path.basename(b));
  });
  const profilePath = path.join(workspace, "profile.md");
  const profile = await fs.readFile(profilePath, "utf8").catch(() => "");
  const setup = setupGaps(profile, resumePdfs);
  const jobs = [];

  const buildTime = Date.now();
  for (const file of markdownFiles) {
    const markdown = await fs.readFile(file, "utf8");
    const fm = parseFrontmatter(markdown);
    const tags = Array.isArray(fm.tags) ? fm.tags : [];
    if (!tags.includes("jobs") && !fm.company && !fm.role) continue;
    const stat = await fs.stat(file).catch(() => null);
    const mtime = stat ? stat.mtimeMs : 0;
    const justAdded = mtime > 0 && (buildTime - mtime) < 60_000;
    const body = stripFrontmatter(markdown);
    jobs.push({
      file,
      name: path.basename(file),
      justAdded,
      company: fm.company || "",
      role: fm.role || "",
      status: fm.status || "unknown",
      location: fm.location || "",
      comp: fm.comp || "",
      priority: fm.priority || "",
      fitScore: fm.fit_score || "",
      link: fm.link || "",
      contact: fm.contact || "",
      nextAction: fm.next_action || "",
      nextActionDate: fm.next_action_date || "",
      lastInteraction: fm.last_interaction || "",
      deadline: fm.deadline || "",
      channel: fm.channel || "",
      resumeUsed: fm.resume_used || "",
      department: fm.department || "",
      employmentType: fm.employment_type || "",
      reportsTo: fm.reports_to || "",
      latestEvent: latestEventDate(fm.events),
      body,
      bodyHtml: postProcessJobBody(renderMarkdown(body)),
    });
  }

  // Default sort: most recent activity at the top. Empty dates fall to bottom.
  // Activity = the most recent of nextActionDate / latestEvent / lastInteraction.
  // (ISO date strings sort lexically.)
  const activityKey = (job) => {
    const candidates = [job.nextActionDate, job.latestEvent, job.lastInteraction]
      .filter((v) => typeof v === "string" && v);
    if (!candidates.length) return "";
    return candidates.slice().sort().pop();
  };
  jobs.sort((a, b) => {
    const ak = activityKey(a);
    const bk = activityKey(b);
    if (ak && bk && ak !== bk) return bk.localeCompare(ak);
    if (ak && !bk) return -1;
    if (!ak && bk) return 1;
    return String(a.company).localeCompare(String(b.company));
  });

  const activeStatuses = ["applied", "intro", "recruiter", "screen", "interview", "takehome", "final"];
  // "Needs action" is reactive only — there's a concrete next_action_date that's hit/passed,
  // OR the user is actively blocked (takehome assigned, screen scheduled, offer pending decision).
  // We do NOT flag jobs as needing action just because they're "applied" with no next_action set;
  // those are waiting, not blocking the user.
  const reactiveStatuses = new Set(["takehome", "offer", "negotiation"]);
  const dueJobs = jobs.filter((job) => isDue(job.nextActionDate) || reactiveStatuses.has(String(job.status)));
  const activeJobs = jobs.filter((job) => !["rejected", "archived", "declined", "accepted"].includes(String(job.status)));
  const appliedJobs = jobs.filter((job) => ["applied", "intro", "recruiter", "screen", "interview", "takehome", "final", "offer", "negotiation", "accepted"].includes(String(job.status)));
  const stageCounts = jobs.reduce((acc, job) => {
    const stage = stageForStatus(job.status);
    acc[stage] = (acc[stage] || 0) + 1;
    return acc;
  }, {});
  const stages = [
    { key: "setup", label: "Setup", detail: setup.gaps.length ? `${setup.gaps.length} gaps` : "Minimum context" },
    { key: "positioning", label: "Positioning", detail: /TODO/.test(profile) ? "Draft profile" : "Profile ready" },
    { key: "application", label: "Apply", detail: `${stageCounts.application || 0} queued` },
    { key: "pipeline", label: "Pipeline", detail: `${activeJobs.length} active` },
    { key: "follow_up", label: "Follow-up", detail: `${dueJobs.length} actions` },
    { key: "offer", label: "Offer", detail: `${stageCounts.offer || 0} open` },
  ];
  const currentStage = currentStageKey({ setup, jobs, dueJobs });
  const currentIndex = stages.findIndex((stage) => stage.key === currentStage);
  const prompt = handoffPrompt(stages[currentIndex] || stages[0], setup, dueJobs);
  const activityDays = buildActivityDays(jobs);
  const recentActivity = activityDays.reduce((sum, day) => sum + day.count, 0);
  const primaryResume = resumePdfs[0];
  const narrative = buildNarrative({ profile, setup, jobs, dueJobs, activeJobs });
  const userName = extractFirstName(profile, primaryResume);
  const profileFm = parseFrontmatter(profile);
  const agentName = (typeof profileFm.agent === "string" && profileFm.agent.trim()) || "";
  const welcome = buildPrompt({ name: userName, setup, jobs, dueJobs, primaryResume, agent: agentName });
  const stageItems = buildStageItems({ profile, jobs, dueJobs, setup, primaryResume });

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>/skill hireable</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230a0a0a'/%3E%3Ctext x='16' y='22' font-family='ui-monospace,SFMono-Regular,Menlo,monospace' font-size='18' font-weight='600' fill='%23ffffff' text-anchor='middle'%3E/%3C/text%3E%3C/svg%3E">
  <link rel="preconnect" href="https://rsms.me/">
  <link rel="stylesheet" href="https://rsms.me/inter/inter.css">
  <style>
    :root {
      color-scheme: light;
      --bg: #ffffff;
      --panel: #ffffff;
      --field: #f4f4f4;
      --line: #e5e5e5;
      --line-strong: #d0d0d0;
      --ink: #0a0a0a;
      --ink-2: #2b2b2b;
      --muted: #737373;
      --soft: #a3a3a3;
      --shadow-sm: 0 1px 0 rgba(0,0,0,.02);
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    body {
      background: var(--bg);
      color: var(--ink);
      font: 13.5px/1.5 "Inter var", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
      font-feature-settings: "ss01", "cv11";
    }
    button, input, select, textarea { font: inherit; color: inherit; }
    a { color: var(--ink); text-decoration: none; border-bottom: 1px solid var(--line-strong); transition: border-color .12s ease; }
    a:hover { border-bottom-color: currentColor; }
    .wrap { max-width: 1640px; margin: 0 auto; padding: 28px 32px 48px; }

    /* HERO */
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 24px;
      align-items: center;
      padding: 18px 4px;
      margin-bottom: 6px;
    }
    .brand { display: flex; flex-direction: column; min-width: 0; gap: 4px; }
    .brand h1 {
      margin: 0;
      font: 600 24px/1.1 ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace;
      letter-spacing: -.01em;
      color: var(--ink);
    }
    .brand h1 .dim { color: var(--soft); font-weight: 400; }
    .brand .sub { margin: 0; color: var(--muted); font-size: 13px; max-width: 60ch; }
    .ws-block {
      margin-top: 4px;
      padding: 14px 4px 0;
      border-top: 1px solid var(--line);
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 11px;
      color: var(--soft);
    }
    .ws-block-label {
      color: var(--muted);
      font-size: 11px;
    }
    .ws-block-path {
      display: block;
      box-sizing: border-box;
      width: 100%;
      font-family: ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      color: var(--muted);
      background: var(--field);
      padding: 4px 8px;
      border-radius: 4px;
      word-break: break-all;
      line-height: 1.4;
    }
    .stage-pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 10px 5px 9px;
      background: transparent; color: var(--muted);
      border: 1px solid var(--line);
      border-radius: 999px; font-size: 12px; font-weight: 500;
      margin-right: 4px;
    }
    .stage-pill::before { content: ""; width: 6px; height: 6px; border-radius: 999px; background: var(--ink); }
    .hero-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }

    /* BUTTONS / INPUTS */
    .btn, select, input, textarea {
      min-height: 34px;
      border: 1px solid var(--line);
      border-radius: 9px;
      background: var(--panel);
      padding: 6px 11px;
      transition: border-color .12s ease, background .12s ease;
    }
    select:hover, .btn:hover { border-color: var(--line-strong); }
    select:focus, input:focus, textarea:focus { outline: 0; border-color: var(--ink-2); box-shadow: 0 0 0 3px rgba(20,20,15,.06); }
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; font-weight: 600; font-size: 13px; }
    .btn.primary { background: var(--ink); border-color: var(--ink); color: #f7f6f3; }
    .btn.primary:hover { background: #000; }
    .btn.ghost { background: transparent; }
    .btn:disabled { color: var(--soft); cursor: not-allowed; background: var(--field); }
    a.btn { text-decoration: none; }
    a.btn.primary { border-bottom: 0; }
    a.btn.primary:hover { border-bottom: 0; }

    /* SPLIT BUTTON: Master Resume + derivatives caret */
    .resume-action { position: relative; display: inline-flex; align-items: stretch; }
    .resume-action.has-menu .resume-main {
      border-top-right-radius: 0; border-bottom-right-radius: 0;
      padding-right: 11px;
      box-shadow: inset -1px 0 0 rgba(255,255,255,.18);
    }
    .resume-action .resume-caret {
      border-top-left-radius: 0; border-bottom-left-radius: 0;
      padding: 0 9px; min-height: 34px;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .resume-action .resume-caret svg { transition: transform .15s ease; }
    .resume-action .resume-caret[aria-expanded="true"] svg { transform: rotate(180deg); }
    .resume-menu {
      position: absolute; top: calc(100% + 6px); right: 0; z-index: 30;
      min-width: 240px; max-width: 360px;
      background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
      padding: 4px;
      box-shadow: 0 12px 28px -16px rgba(20,20,15,.22), 0 1px 0 rgba(20,20,15,.04);
      display: grid; gap: 1px;
    }
    .resume-menu a {
      display: block; padding: 7px 10px; border-radius: 6px;
      color: var(--ink-2); font-size: 13px; border-bottom: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .resume-menu a:hover { background: var(--field); color: var(--ink); border-bottom: 0; }
    .resume-menu[hidden] { display: none; }

    /* LAYOUT */
    .layout { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 16px; align-items: start; }
    .stack { display: grid; gap: 16px; align-content: start; }

    /* PANEL */
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; }
    .panel.bare { border: 0; background: transparent; border-radius: 0; }
    .panel.bare > .panel-head { padding-left: 4px; padding-right: 4px; border-bottom: 0; padding-bottom: 4px; }
    .panel.bare > .progress { padding-left: 4px; padding-right: 4px; }
    .panel.bare > .progress::before { left: 11px; }
    .panel-head { padding: 14px 18px 12px; border-bottom: 1px solid var(--line); display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .panel h2 { margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); font-weight: 600; }
    .panel-head .lede { color: var(--muted); font-size: 12.5px; }
    .panel-body { padding: 16px 18px 18px; }

    /* PROGRESS */
    .progress { position: relative; padding: 4px 18px 12px; }
    .progress::before { content: ""; position: absolute; top: 26px; bottom: 26px; left: 26px; width: 2px; background: var(--line); }
    .step { display: block; }
    .step + .step { margin-top: 0; }
    .step-summary {
      display: grid; grid-template-columns: 18px minmax(0, 1fr);
      gap: 14px; padding: 8px 0; cursor: pointer;
      list-style: none; align-items: start;
    }
    .step-summary::-webkit-details-marker { display: none; }
    .step-summary::marker { content: ""; }
    .dot { z-index: 1; width: 18px; height: 18px; margin-top: 3px; border: 1.5px solid var(--line-strong); border-radius: 999px; background: var(--panel); position: relative; }
    .step.done .dot { background: var(--ink); border-color: var(--ink); }
    .step.done .dot::after { content: ""; position: absolute; top: 3px; left: 5px; width: 4px; height: 7px; border: solid #fff; border-width: 0 1.5px 1.5px 0; transform: rotate(45deg); }
    .step.current .dot { background: var(--ink); border-color: var(--ink); box-shadow: 0 0 0 4px color-mix(in oklab, var(--ink) 10%, transparent); }
    .step-label { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
    .step strong { font-weight: 600; font-size: 13.5px; }
    .step.current strong { color: var(--ink); }
    .step:not(.current):not(.done) strong { color: var(--ink-2); }
    .tag { display: inline-flex; align-items: center; min-height: 20px; padding: 1px 8px; border-radius: 6px; background: var(--field); color: var(--muted); font-size: 11.5px; white-space: nowrap; font-variant-numeric: tabular-nums; }

    /* Step items list */
    .step-items {
      list-style: none; margin: 0;
      padding: 4px 0 12px 32px;
      display: grid; gap: 6px;
    }
    .step-items li {
      display: grid;
      grid-template-columns: 14px minmax(0, 1fr) auto;
      gap: 8px; align-items: start;
      font-size: 12.5px; line-height: 1.5;
      color: var(--ink-2);
    }
    .step-items li.muted { color: var(--soft); }
    .step-items li.list .bullet {
      width: 4px; height: 4px; border-radius: 999px;
      background: var(--soft); margin-top: 8px;
    }
    .step-items li.check .checkbox {
      width: 12px; height: 12px;
      border: 1.5px solid var(--line-strong); border-radius: 3px;
      margin-top: 4px; position: relative; flex-shrink: 0;
    }
    .step-items li.check.done { color: var(--muted); }
    .step-items li.check.done .checkbox { background: var(--ink); border-color: var(--ink); }
    .step-items li.check.done .checkbox::after {
      content: ""; position: absolute; top: 1px; left: 3px;
      width: 3px; height: 6px;
      border: solid #fff; border-width: 0 1.5px 1.5px 0;
      transform: rotate(45deg);
    }
    .step-item-label { min-width: 0; overflow-wrap: break-word; }
    .step-item-date {
      font: 11px/1.5 ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace;
      color: var(--soft); white-space: nowrap;
    }
    .step-empty { margin: 4px 0 12px 32px; color: var(--soft); font-size: 12.5px; font-style: italic; }

    /* Section help prompt: status tag doubles as a copy-prompt button. */
    button.tag {
      appearance: none; -webkit-appearance: none;
      font: inherit; font-size: 11.5px; font-weight: 500;
      background: var(--field);
      border: 1px solid var(--line);
      color: var(--muted);
      cursor: pointer; position: relative;
      transition: background .12s ease, color .12s ease, border-color .12s ease;
    }
    button.tag:focus-visible { outline: 2px solid var(--ink-2); outline-offset: 2px; }
    button.tag.tag-prompt:hover,
    button.tag.tag-prompt.copied {
      background: var(--ink);
      border-color: var(--ink);
      color: transparent;
    }
    button.tag.tag-prompt::after {
      content: "";
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      color: #f7f6f3; font-weight: 500;
      letter-spacing: -.005em;
      opacity: 0; transition: opacity .12s ease;
      pointer-events: none;
    }
    button.tag.tag-prompt:hover::after { content: "Get help"; opacity: 1; }
    button.tag.tag-prompt.copied::after { content: "Copied"; opacity: 1; }
    [hidden] { display: none !important; }

    /* TOP ROW: heatmap + narrative side by side */
    .top-row { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 16px; align-items: start; padding: 4px 0 22px; }
    .narrative { display: none; }
    .status-card {
      background: var(--field);
      border-radius: 12px;
      padding: 18px 20px 16px;
    }
    .status-greeting { font-size: 16px; font-weight: 600; color: var(--ink); margin: 0 0 4px; }
    .status-sub { font-size: 13px; color: var(--muted); margin: 0 0 12px; }
    .status-narrative p { margin: 0 0 8px; color: var(--ink-2); font-size: 13.5px; line-height: 1.55; }
    .status-narrative p:last-child { margin-bottom: 0; }
    .status-narrative b { color: var(--ink); font-weight: 600; }
    .narrative p { margin: 0 0 10px; color: var(--ink-2); font-size: 14px; line-height: 1.6; }
    .narrative p:last-child { margin-bottom: 0; }
    .narrative b { color: var(--ink); font-weight: 600; }
    .prompt-block { margin: 0 0 18px; }
    .prompt-greeting { font-size: 16px; font-weight: 600; color: var(--ink); line-height: 1.4; letter-spacing: -.005em; margin-bottom: 6px; }
    .prompt-body { font-size: 14px; color: var(--ink-2); line-height: 1.6; max-width: 64ch; }

    .heat-block { display: grid; gap: 12px; width: 100%; padding: 0 4px; }
    .heat-grid {
      display: grid;
      grid-template-rows: repeat(7, 1fr);
      grid-auto-flow: column;
      grid-auto-columns: 1fr;
      gap: 4px;
      width: 100%;
      aspect-ratio: 16 / 7;
    }
    .day {
      width: 100%; height: 100%;
      border-radius: 3px;
      background: #ededed;
      box-shadow: inset 0 0 0 1px rgba(0,0,0,.06);
      cursor: pointer;
    }
    .day:hover { box-shadow: inset 0 0 0 2px var(--ink); }
    .day.selected { box-shadow: inset 0 0 0 2.5px var(--ink); background-color: #fff !important; }
    .day.no-events { cursor: default; }
    .day.no-events:hover { box-shadow: inset 0 0 0 1px rgba(0,0,0,.06); }
    .level-1 { background: #d4d4d4; }
    .level-2 { background: #a3a3a3; }
    .level-3 { background: #525252; }
    .level-4 { background: var(--ink); }
    .heat-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 11px; color: var(--muted); }
    .heat-legend { display: inline-flex; align-items: center; gap: 4px; }
    .heat-legend .day { width: 11px; height: 11px; cursor: default; }
    .heat-legend .day:hover { box-shadow: inset 0 0 0 1px rgba(0,0,0,.06); }
    #heatHover {
      font-variant-numeric: tabular-nums;
      min-height: 14px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
      flex: 1 1 auto;
    }

    /* DATE FILTER BANNER */
    .date-banner { display: none; align-items: center; gap: 10px; padding: 8px 14px; margin: 0 0 12px; background: var(--field); border: 1px solid var(--line); border-radius: 8px; font-size: 12.5px; color: var(--ink-2); }
    .date-banner.show { display: inline-flex; }
    .date-banner button { background: transparent; border: 0; cursor: pointer; color: var(--muted); padding: 0; font: inherit; text-decoration: underline; }

    /* APPLICATIONS */
    .toolbar { display: grid; grid-template-columns: minmax(260px, 1fr) 160px 160px; gap: 10px; padding: 12px 18px; border-bottom: 1px solid var(--line); }
    .toolbar input { padding-left: 32px; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%236c6a62' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m21 21-4.3-4.3'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: 11px center; }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; padding: 10px 18px 12px; border-bottom: 1px solid var(--line); }
    .chip { min-height: 28px; border: 1px solid var(--line); border-radius: 999px; background: var(--panel); padding: 3px 11px; cursor: pointer; color: var(--ink-2); font-weight: 500; font-size: 12.5px; transition: background .12s ease, border-color .12s ease; }
    .chip:hover { border-color: var(--line-strong); }
    .chip.active { background: var(--ink); border-color: var(--ink); color: #f7f6f3; }

    table { width: 100%; border-collapse: collapse; }
    thead th { padding: 10px 18px; border-bottom: 1px solid var(--line); text-align: left; color: var(--muted); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; background: var(--field); }
    tbody td { padding: 12px 18px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    tbody tr:last-child td { border-bottom: 0; }
    tbody tr:hover { background: color-mix(in oklab, var(--field) 50%, transparent); }
    td.meta { font: 12px/1.45 ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace; color: var(--muted); font-variant-numeric: tabular-nums; }
    td .role { color: var(--muted); font-size: 12.5px; }
    td .company { font-weight: 600; color: var(--ink); }
    td .resume-link { font-size: 12.5px; color: var(--ink-2); border-bottom: 1px solid var(--line); }
    td .resume-link:hover { color: var(--ink); border-bottom-color: var(--line-strong); }

    .pill { display: inline-flex; align-items: center; gap: 5px; min-height: 20px; padding: 2px 9px; border-radius: 999px; background: var(--field); color: var(--ink-2); font-size: 11.5px; font-weight: 500; text-transform: capitalize; letter-spacing: .01em; border: 1px solid var(--line); }
    .pill::before { content: ""; width: 5px; height: 5px; border-radius: 999px; background: currentColor; opacity: .55; }
    .status-applied, .status-screen, .status-interview, .status-final, .status-in_process,
    .status-intro, .status-recruiter, .status-offer, .status-negotiation { background: #fff; color: var(--ink); border-color: var(--line-strong); }
    .status-rejected, .status-archived, .status-declined { background: var(--field); color: var(--soft); border-color: var(--line); text-decoration: line-through; text-decoration-thickness: 1px; }
    .status-to_apply, .status-drafting, .status-ready_to_apply { background: var(--field); color: var(--ink-2); }

    .muted { color: var(--muted); }
    .empty { padding: 24px 18px; color: var(--muted); text-align: center; }
    @keyframes just-added-flash {
      0% { background: color-mix(in oklab, var(--ink) 8%, transparent); }
      100% { background: transparent; }
    }
    tr.just-added > td { animation: just-added-flash 4s ease-out forwards; }
    .just-added-chip {
      display: inline-block;
      margin-left: 8px;
      padding: 1px 7px;
      background: var(--ink);
      color: var(--bg);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      border-radius: 4px;
      vertical-align: 2px;
      animation: just-added-fade 6s ease-out forwards;
    }
    @keyframes just-added-fade {
      0% { opacity: 1; }
      80% { opacity: 1; }
      100% { opacity: 0; }
    }

    /* JOB DETAIL DRAWER */
    tbody tr { cursor: pointer; }
    tbody tr.is-active { background: var(--field); }
    .drawer-backdrop { position: fixed; inset: 0; background: rgba(10,10,10,0); pointer-events: none; transition: background .18s ease; z-index: 50; }
    .drawer-backdrop.open { background: rgba(10,10,10,.18); pointer-events: auto; }
    .drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(560px, 100vw); background: var(--panel); border-left: 1px solid var(--line); transform: translateX(100%); transition: transform .22s ease; z-index: 60; display: flex; flex-direction: column; box-shadow: -16px 0 40px -20px rgba(10,10,10,.18); }
    .drawer.open { transform: translateX(0); }
    .drawer-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 22px 26px 16px; border-bottom: 1px solid var(--line); }
    .drawer-head h3 { margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -.01em; }
    .drawer-head .role { margin: 4px 0 8px; color: var(--muted); font-size: 13.5px; }
    .drawer-head .pill { font-size: 11px; }
    .drawer-close { background: transparent; border: 0; cursor: pointer; padding: 4px 8px; font-size: 18px; color: var(--muted); border-radius: 6px; line-height: 1; }
    .drawer-close:hover { background: var(--field); color: var(--ink); }
    /* Role snapshot — durable defining info for this opportunity. Shown above the chronological cards. */
    .drawer-snapshot {
      margin: 0;
      padding: 14px 26px 16px;
      border-bottom: 1px solid var(--line);
      display: grid;
      grid-template-columns: 92px minmax(0, 1fr);
      gap: 6px 14px;
      font-size: 12.5px;
      line-height: 1.5;
    }
    .drawer-snapshot dt {
      margin: 0;
      color: var(--muted);
      font-weight: 500;
      font-size: 10.5px;
      text-transform: uppercase;
      letter-spacing: .06em;
      padding-top: 2px;
    }
    .drawer-snapshot dd {
      margin: 0;
      color: var(--ink);
      word-break: break-word;
    }
    .drawer-snapshot dd a {
      border-bottom: 0;
      color: var(--ink);
    }
    .drawer-snapshot dd a:hover {
      border-bottom: 1px solid var(--line-strong);
    }
    .drawer-body { flex: 1; overflow-y: auto; padding: 16px 26px 28px; font-size: 13.5px; line-height: 1.6; color: var(--ink-2); }
    .drawer-body > h1:first-child { display: none; } /* note title duplicates the drawer head */
    .drawer-body h1 { font-size: 20px; margin: 0 0 14px; color: var(--ink); font-weight: 600; line-height: 1.3; }
    .drawer-body h3 { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; margin: 12px 0 6px; font-weight: 600; }
    .drawer-body h4 { font-size: 13px; margin: 12px 0 6px; color: var(--ink); }

    /* Event cards: each h2 + content block becomes one card. Past = muted, current = active. */
    .event-card {
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 14px 16px;
      margin: 0 0 12px;
      background: var(--field);
    }
    .event-card.current {
      background: var(--panel);
      border-color: var(--ink-2);
      box-shadow: 0 1px 0 rgba(20,20,15,.04), 0 4px 14px -6px rgba(20,20,15,.10);
    }
    .event-card h2 {
      margin: 0 0 8px;
      font-size: 14px; font-weight: 600;
      color: var(--ink); line-height: 1.3;
      letter-spacing: 0; text-transform: none;
    }
    .event-card .event-date { color: var(--ink); font-weight: 600; }
    .event-card .event-sep { color: var(--soft); }
    .event-card .event-title { color: var(--ink-2); font-weight: 500; }
    .event-card.current .event-title { color: var(--ink); font-weight: 600; }
    .event-card:not(.current) { color: var(--muted); }
    .event-card:not(.current) p { color: var(--muted); }
    .event-card:not(.current) .event-date { color: var(--ink-2); }
    .event-card p { margin: 0 0 8px; }
    .event-card p:last-child { margin-bottom: 0; }
    .event-card ul, .event-card ol { margin: 0 0 8px; padding-left: 20px; }
    .event-card li { margin: 0 0 3px; }
    /* The first list inside each card is a key/value meta block (Channel / Resume / Location / etc). */
    .event-card > ul:first-of-type {
      list-style: none;
      padding-left: 0;
      margin: 0 0 14px;
      display: grid;
      gap: 6px;
      font-size: 12.5px;
    }
    .event-card > ul:first-of-type li {
      margin: 0; padding: 0; line-height: 1.5;
      display: flex;
      gap: 12px;
      align-items: baseline;
    }
    .event-card > ul:first-of-type li strong {
      flex: 0 0 92px;
      font-weight: 500;
      color: var(--muted);
      font-size: 10.5px;
      text-transform: uppercase;
      letter-spacing: .06em;
    }
    .event-card > ul:first-of-type a {
      border-bottom: 0;
      color: var(--ink);
    }
    .event-card > ul:first-of-type a:hover {
      border-bottom: 1px solid var(--line-strong);
    }
    .event-card li.task {
      list-style: none; margin-left: -20px; padding-left: 0;
      display: grid; grid-template-columns: 14px 1fr; gap: 8px; align-items: start;
    }
    .event-card li.task .task-box {
      width: 12px; height: 12px;
      border: 1.5px solid var(--line-strong); border-radius: 3px;
      margin-top: 5px; flex-shrink: 0; position: relative;
      background: var(--panel);
    }
    .event-card.current li.task .task-box { background: var(--panel); }
    .event-card li.task.done .task-box { background: var(--ink); border-color: var(--ink); }
    .event-card li.task.done .task-box::after {
      content: ""; position: absolute; top: 1px; left: 3px;
      width: 3px; height: 6px;
      border: solid #fff; border-width: 0 1.5px 1.5px 0;
      transform: rotate(45deg);
    }
    .event-card li.task.done .task-label { color: var(--muted); text-decoration: line-through; }

    .application-brief {
      margin: 0 0 18px;
      background: var(--field);
      border: 1px solid var(--line);
      border-radius: 10px;
      overflow: hidden;
    }
    .application-brief > .brief-summary {
      list-style: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      user-select: none;
      transition: background .12s ease;
    }
    .application-brief > .brief-summary::-webkit-details-marker { display: none; }
    .application-brief > .brief-summary:hover { background: var(--bg); }
    .brief-summary-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--ink-2);
    }
    .brief-summary-counts {
      font-size: 12px;
      color: var(--muted);
      margin-left: auto;
    }
    .brief-bulk-bar {
      display: flex;
      justify-content: flex-end;
      margin: 0 0 12px;
    }
    .brief-bulk-fill {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 5px 11px;
      font: inherit;
      font-size: 11.5px;
      font-weight: 500;
      color: var(--ink-2);
      cursor: pointer;
      transition: background .12s ease, border-color .12s ease, color .12s ease, transform .12s ease;
    }
    .brief-bulk-fill:hover {
      background: var(--bg);
      border-color: var(--line-strong);
      color: var(--ink);
    }
    .brief-bulk-fill:active { transform: translateY(1px); }
    .brief-bulk-fill.copied {
      background: var(--ink);
      border-color: var(--ink);
      color: var(--bg);
    }
    .brief-bulk-fill.copy-failed { border-color: #c0392b; }
    .brief-summary-chevron {
      display: inline-block;
      font-size: 14px;
      color: var(--soft);
      transition: transform .15s ease;
    }
    .application-brief[open] > .brief-summary .brief-summary-chevron {
      transform: rotate(90deg);
    }
    .application-brief[open] > .brief-summary {
      border-bottom: 1px solid var(--line);
    }
    .brief-body {
      padding: 14px 16px 16px;
    }
    .brief-section { margin: 0 0 14px; }
    .brief-section:last-child { margin-bottom: 0; }
    .brief-section-label {
      margin: 0 0 8px;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .brief-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .brief-chip {
      display: inline-flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      max-width: 320px;
      padding: 6px 10px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 6px;
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition: background .12s ease, border-color .12s ease, transform .12s ease;
    }
    button.brief-chip { color: inherit; }
    .brief-chip:hover {
      background: var(--bg);
      border-color: var(--line-strong);
    }
    .brief-chip:active { transform: translateY(1px); }
    .brief-chip.needs {
      background: transparent;
      border-color: var(--line);
      cursor: help;
      opacity: 0.7;
    }
    .brief-chip.needs:hover { opacity: 0.9; }
    .brief-chip.empty { cursor: default; }
    .brief-chip .brief-label {
      font-size: 10.5px;
      font-weight: 500;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .brief-chip .brief-value {
      font-size: 13px;
      color: var(--ink);
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .brief-chip .brief-value.muted { color: var(--soft); }
    .brief-chip.needs .brief-value { color: var(--soft); font-style: italic; }
    .brief-chip.copied {
      background: var(--ink);
      border-color: var(--ink);
    }
    .brief-chip.copied .brief-label,
    .brief-chip.copied .brief-value { color: var(--bg); }
    .brief-chip.copied .brief-value::after { content: "  ✓"; }
    .brief-chip.copy-failed { border-color: #c0392b; }

    .brief-essays {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .brief-essay {
      display: block;
      width: 100%;
      padding: 12px 14px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      font: inherit;
      color: inherit;
      text-align: left;
      cursor: pointer;
      transition: background .12s ease, border-color .12s ease;
    }
    button.brief-essay { color: inherit; }
    .brief-essay:hover {
      background: var(--bg);
      border-color: var(--line-strong);
    }
    .brief-essay.needs,
    .brief-essay.empty {
      background: transparent;
      cursor: default;
    }
    .brief-essay.needs:hover,
    .brief-essay.empty:hover {
      background: transparent;
      border-color: var(--line);
    }
    .brief-essay-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin: 0 0 6px;
    }
    .brief-essay-label {
      font-size: 10.5px;
      font-weight: 500;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .brief-essay-copy-hint {
      font-size: 10.5px;
      color: var(--soft);
      opacity: 0;
      transition: opacity .12s ease;
    }
    .brief-essay:hover .brief-essay-copy-hint { opacity: 1; }
    .brief-essay-value {
      font-size: 13px;
      line-height: 1.55;
      color: var(--ink);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .brief-essay-value.muted { color: var(--muted); font-size: 12.5px; font-style: italic; }
    .brief-essay-value code {
      background: var(--field);
      padding: 1px 5px;
      border-radius: 4px;
      font: 11.5px/1.4 ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace;
      font-style: normal;
    }
    .brief-essay.copied {
      background: var(--ink);
      border-color: var(--ink);
    }
    .brief-essay.copied .brief-essay-label,
    .brief-essay.copied .brief-essay-value,
    .brief-essay.copied .brief-essay-copy-hint { color: var(--bg); }
    .brief-essay.copied .brief-essay-copy-hint { opacity: 1; }
    .brief-essay.copy-failed { border-color: #c0392b; }

    .drawer-body p { margin: 0 0 12px; }
    .drawer-body ul, .drawer-body ol { margin: 0 0 14px; padding-left: 22px; }
    .drawer-body li { margin: 0 0 4px; }
    .drawer-body code { background: var(--field); padding: 1px 6px; border-radius: 4px; font: 12px/1.4 ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace; }
    .drawer-body pre { background: var(--field); padding: 12px 14px; border-radius: 8px; overflow-x: auto; margin: 0 0 14px; }
    .drawer-body pre code { background: transparent; padding: 0; font-size: 12px; }
    .drawer-body blockquote { margin: 0 0 12px; padding: 4px 12px; border-left: 2px solid var(--line-strong); color: var(--muted); }
    .drawer-body hr { border: 0; border-top: 1px solid var(--line); margin: 18px 0; }
    .drawer-body a { color: var(--ink); border-bottom: 1px solid var(--line-strong); }
    .drawer-foot { padding: 14px 26px; border-top: 1px solid var(--line); display: flex; gap: 10px; justify-content: flex-end; }
    .hidden { display: none !important; }

    @media (max-width: 1100px) {
      .layout { grid-template-columns: 1fr; }
      .hero { grid-template-columns: 1fr; }
      .hero-actions { justify-content: flex-start; }
    }
    @media (max-width: 900px) {
      .top-row { grid-template-columns: 1fr; gap: 28px; }
      .heat-block, .heat-grid { width: 100%; max-width: 320px; }
    }
    @media (max-width: 720px) {
      .wrap { padding: 16px; }
      .hero { padding: 14px 4px; }
      .toolbar { grid-template-columns: 1fr; }
      .toolbar select { width: 100%; }
      .chips { gap: 4px; }
      table, thead, tbody, th, td, tr { display: block; }
      thead { display: none; }
      tbody tr { border-bottom: 1px solid var(--line); padding: 10px 0; }
      tbody td { border: 0; padding: 4px 18px; }
      tbody td::before { content: attr(data-label); display: block; color: var(--muted); font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 2px; }
      .narrative { max-width: 100%; }
      .narrative p { font-size: 13.5px; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="hero">
      <div class="brand">
        <h1><span class="dim">/skill</span> hireable</h1>
        <p class="sub">Agent driven job-search pipeline. Markdown powered memory. Ingest any posting format, receive full-context updates.</p>
      </div>
      <div class="hero-actions">
        ${(() => {
          if (!primaryResume) return `<button class="btn primary" disabled>No Resume PDF</button>`;
          const derivatives = resumePdfs.filter((file) => file !== primaryResume);
          const caret = derivatives.length ? `
            <button class="btn primary resume-caret" type="button" id="resumeMenuToggle" aria-label="Other resume versions" aria-haspopup="true" aria-expanded="false">
              <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <div class="resume-menu" id="resumeMenu" hidden role="menu">
              ${derivatives.map((file) => `<a href="${escapeHtml(relHref(file))}" target="_blank" rel="noopener" role="menuitem">${escapeHtml(path.basename(file))}</a>`).join("")}
            </div>` : "";
          return `<div class="resume-action${derivatives.length ? " has-menu" : ""}">
            <a class="btn primary resume-main" href="${escapeHtml(relHref(primaryResume))}" target="_blank" rel="noopener">Master Resume</a>
            ${caret}
          </div>`;
        })()}
      </div>
    </header>

    <div class="top-row">
      <div class="heat-block" aria-label="Activity over the last 16 weeks">
        <div class="heat-grid" id="heatGrid">
          ${activityDays.map((day) => `<span class="day ${day.count ? "" : "no-events"} level-${day.level}" data-date="${day.date}" data-count="${day.count}" aria-label="${day.date} · ${day.count} ${day.count === 1 ? "event" : "events"}"></span>`).join("")}
        </div>
        <div class="heat-foot">
          <span id="heatHover">${recentActivity === 0 ? "No activity yet — your dashboard will fill in as you work." : "Hover to inspect · click to filter"}</span>
          <span class="heat-legend">
            <span>Less</span>
            <span class="day level-0"></span>
            <span class="day level-1"></span>
            <span class="day level-2"></span>
            <span class="day level-3"></span>
            <span class="day level-4"></span>
            <span>More</span>
          </span>
        </div>
      </div>
      ${(welcome || narrative.length) ? `<section class="status-card">
        ${welcome ? `<div class="status-greeting">${escapeHtml(welcome.greeting)}</div>` : ""}
        ${welcome && welcome.body ? `<div class="status-sub">${escapeHtml(welcome.body)}</div>` : ""}
        ${narrative.length ? `<div class="status-narrative">${narrative.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</div>` : ""}
      </section>` : ""}
    </div>

    <main class="layout">
      <aside class="stack">
        <section class="panel bare">
          <div class="panel-head">
            <h2>Progress</h2>
          </div>
          <div class="progress">
            ${stages.map((stage, index) => {
              const current = stage.key === currentStage;
              const done = !setup.gaps.length && index < currentIndex;
              const items = stageItems[stage.key] || [];
              const stagePrompt = buildStagePrompt({ stage, items, jobs, dueJobs });
              return `<details class="step ${done ? "done" : ""} ${current ? "current" : ""}" ${current ? "open" : ""}>
                <summary class="step-summary">
                  <span class="dot"></span>
                  <span class="step-label">
                    <strong>${escapeHtml(stage.label)}</strong>
                    ${stagePrompt
                      ? `<button type="button" class="tag tag-prompt" data-copy-prompt-text="${escapeHtml(stagePrompt)}" data-default-label="${escapeHtml(stage.detail)}" aria-label="Copy help prompt for ${escapeHtml(stage.label)}">${escapeHtml(stage.detail)}</button>`
                      : `<span class="tag">${escapeHtml(stage.detail)}</span>`}
                  </span>
                </summary>
                ${items.length ? `<ul class="step-items">${items.map((item) => {
                  const classes = [];
                  classes.push(item.kind === "check" ? "check" : "list");
                  if (item.kind === "check" && item.done) classes.push("done");
                  if (item.muted) classes.push("muted");
                  const trail = item.date ? `<span class="step-item-date">${escapeHtml(item.date)}</span>` : "";
                  return `<li class="${classes.join(" ")}">
                    <span class="${item.kind === "check" ? "checkbox" : "bullet"}" aria-hidden="true"></span>
                    <span class="step-item-label">${escapeHtml(item.label)}</span>
                    ${trail}
                  </li>`;
                }).join("")}</ul>` : `<p class="step-empty">Nothing here yet.</p>`}
              </details>`;
            }).join("")}
          </div>
        </section>
        <div class="ws-block">
          <span class="ws-block-label">where:</span>
          <code class="ws-block-path">${escapeHtml(workspace)}</code>
        </div>
        <textarea id="agentPrompt" readonly hidden aria-hidden="true">${escapeHtml(prompt)}</textarea>
      </aside>

      <section class="stack">
        <div class="date-banner" id="dateBanner">
          <span>Filtering by <b id="dateBannerText"></b></span>
          <button type="button" id="dateBannerClear">clear</button>
        </div>
        <section class="panel" id="applications">
          <div class="panel-head">
            <h2>Applications</h2>
            <span class="lede">${jobs.length} total · ${activeJobs.length} active · ${dueJobs.length} need action</span>
          </div>
          <div class="toolbar">
            <input id="searchInput" type="search" placeholder="Search company, role, note, action">
            <select id="statusFilter">
              <option value="">All statuses</option>
              ${[...new Set(jobs.map((job) => job.status))].sort().map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(formatStatus(status))}</option>`).join("")}
            </select>
          </div>
          <div class="chips">
            <button class="chip active" type="button" data-quick-filter="all">All</button>
            <button class="chip" type="button" data-quick-filter="leads">Leads</button>
            <button class="chip" type="button" data-quick-filter="active">Active</button>
            <button class="chip" type="button" data-quick-filter="attention">Needs action</button>
            <button class="chip" type="button" data-quick-filter="applied">Applied+</button>
            <button class="chip" type="button" data-quick-filter="closed">Closed</button>
          </div>
          <table>
            <thead><tr><th>Opportunity</th><th>Status</th><th>Comp</th><th>Activity</th><th>Resume</th></tr></thead>
            <tbody id="jobsBody">
              ${jobs.map((job, index) => {
                const closed = ["rejected", "archived", "declined", "accepted"].includes(String(job.status));
                const attention = dueJobs.includes(job);
                const applied = ["applied", "intro", "recruiter", "screen", "interview", "takehome", "final", "offer", "negotiation", "accepted"].includes(String(job.status));
                const rowDate = job.nextActionDate || job.latestEvent || job.lastInteraction || "";
                const resumePath = job.resumeUsed
                  ? (job.resumeUsed.startsWith("resumes/") || job.resumeUsed.startsWith("/") ? job.resumeUsed : `resumes/${job.resumeUsed}`)
                  : "";
                const resumeLabel = resumePath ? path.basename(resumePath).replace(/\.pdf$/i, "") : "";
                const resumeCell = resumePath
                  ? `<a href="../${escapeHtml(resumePath)}" target="_blank" rel="noopener" class="resume-link">${escapeHtml(resumeLabel)}</a>`
                  : `<span class="muted">—</span>`;
                return `<tr class="${job.justAdded ? "just-added" : ""}" data-job-index="${index}" data-status="${escapeHtml(job.status)}" data-stage="${stageForStatus(job.status)}" data-attention="${attention}" data-active="${!closed}" data-applied="${applied}" data-closed="${closed}" data-date="${escapeHtml(rowDate)}" data-search="${escapeHtml([job.company, job.role, job.status, job.nextAction, job.name].join(" ").toLowerCase())}">
                  <td data-label="Opportunity"><div class="company">${job.link ? `<a href="${escapeHtml(job.link)}">${escapeHtml(job.company)}</a>` : escapeHtml(job.company)}${job.justAdded ? ' <span class="just-added-chip">Just added</span>' : ""}</div><div class="role">${escapeHtml(job.role)}</div></td>
                  <td data-label="Status"><span class="pill status-${statusClass(job.status)}">${escapeHtml(formatStatus(job.status))}</span></td>
                  <td data-label="Comp">${(() => {
                    if (!job.comp) return '<span class="muted">—</span>';
                    const max = 22;
                    const display = job.comp.length > max ? job.comp.slice(0, max - 1).trimEnd() + "…" : job.comp;
                    return `<span title="${escapeHtml(job.comp)}">${escapeHtml(display)}</span>`;
                  })()}</td>
                  <td class="meta" data-label="Activity">${escapeHtml(job.nextActionDate || job.latestEvent || job.lastInteraction || "—")}</td>
                  <td data-label="Resume">${resumeCell}</td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
          <div class="empty hidden" id="emptyState">No opportunities match those filters.</div>
        </section>
      </section>
    </main>

    <div class="drawer-backdrop" id="drawerBackdrop"></div>
    <aside class="drawer" id="drawer" aria-hidden="true" aria-label="Job detail">
      <div class="drawer-head">
        <div>
          <h3 id="drawerTitle">—</h3>
          <p class="role" id="drawerRole"></p>
          <span class="pill" id="drawerStatus" hidden></span>
        </div>
        <button class="drawer-close" id="drawerClose" aria-label="Close">×</button>
      </div>
      <dl class="drawer-snapshot" id="drawerSnapshot" hidden></dl>
      <div class="drawer-body" id="drawerBody"></div>
      <div class="drawer-foot">
        <a class="btn" id="drawerOpenFile" href="#" target="_blank" rel="noopener">Open file</a>
      </div>
    </aside>
  </div>

  <script type="application/json" id="jobsData">${safeJson(jobs.map((job) => ({
    company: job.company,
    role: job.role,
    status: job.status,
    location: job.location,
    comp: job.comp,
    link: job.link,
    contact: job.contact,
    channel: job.channel,
    department: job.department,
    employmentType: job.employmentType,
    reportsTo: job.reportsTo,
    resumeUsed: job.resumeUsed,
    nextAction: job.nextAction,
    nextActionDate: job.nextActionDate,
    lastInteraction: job.lastInteraction,
    deadline: job.deadline,
    latestEvent: job.latestEvent,
    fileHref: fileHref(job.file),
    name: job.name,
    bodyHtml: job.bodyHtml,
  })))}</script>
  <script>
    const searchInput = document.querySelector("#searchInput");
    const statusFilter = document.querySelector("#statusFilter");
    const rows = [...document.querySelectorAll("#jobsBody tr")];
    const emptyState = document.querySelector("#emptyState");
    const quickFilterButtons = [...document.querySelectorAll("[data-quick-filter]")];
    const dateBanner = document.querySelector("#dateBanner");
    const dateBannerText = document.querySelector("#dateBannerText");
    const dateBannerClear = document.querySelector("#dateBannerClear");
    let quickFilter = "all";
    let dateFilter = "";

    function applyFilters() {
      const query = searchInput.value.trim().toLowerCase();
      const status = statusFilter.value;
      let visible = 0;
      for (const row of rows) {
        const matchesQuick =
          quickFilter === "all" ||
          (quickFilter === "leads" && row.dataset.stage === "lead") ||
          (quickFilter === "active" && row.dataset.active === "true") ||
          (quickFilter === "attention" && row.dataset.attention === "true") ||
          (quickFilter === "applied" && row.dataset.applied === "true") ||
          (quickFilter === "closed" && row.dataset.closed === "true");
        const show = (!query || row.dataset.search.includes(query)) &&
          (!status || row.dataset.status === status) &&
          (!dateFilter || row.dataset.date === dateFilter) &&
          matchesQuick;
        row.classList.toggle("hidden", !show);
        if (show) visible += 1;
      }
      emptyState.classList.toggle("hidden", visible !== 0);
      if (dateBanner) {
        dateBanner.classList.toggle("show", Boolean(dateFilter));
        if (dateFilter && dateBannerText) dateBannerText.textContent = dateFilter;
      }
    }
    for (const input of [searchInput, statusFilter]) input.addEventListener("input", applyFilters);
    for (const button of quickFilterButtons) {
      button.addEventListener("click", () => {
        quickFilter = button.dataset.quickFilter;
        quickFilterButtons.forEach((item) => item.classList.toggle("active", item === button));
        applyFilters();
      });
    }

    function legacyCopy(text) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }
    async function copyPrompt(event) {
      const button = event?.currentTarget;
      const prompt = document.querySelector("#agentPrompt")?.value || "";
      if (!prompt) return;
      let ok = false;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(prompt);
          ok = true;
        }
      } catch { ok = false; }
      if (!ok) ok = legacyCopy(prompt);
      if (button) {
        const original = button.dataset.copyOriginal || button.textContent;
        button.dataset.copyOriginal = original;
        button.textContent = ok ? "Copied" : "Press Cmd+C";
        if (!ok) {
          const ta = document.querySelector("#agentPrompt");
          ta?.focus();
          ta?.select();
        }
        setTimeout(() => { button.textContent = original; }, 1400);
      }
    }
    document.querySelectorAll("[data-copy-prompt]").forEach((button) => button.addEventListener("click", copyPrompt));

    // Per-element copy buttons: tag-prompts use a .copied class for CSS-driven
    // feedback; other buttons swap their visible text.
    document.querySelectorAll("[data-copy-prompt-text]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const text = button.getAttribute("data-copy-prompt-text") || "";
        if (!text) return;
        let ok = false;
        try {
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            ok = true;
          }
        } catch { ok = false; }
        if (!ok) ok = legacyCopy(text);
        if (button.classList.contains("tag-prompt")) {
          button.classList.add("copied");
          setTimeout(() => button.classList.remove("copied"), 1400);
        } else {
          const original = button.dataset.copyOriginal || button.textContent;
          button.dataset.copyOriginal = original;
          button.textContent = ok ? "Copied" : "Press Cmd+C";
          setTimeout(() => { button.textContent = original; }, 1400);
        }
      });
    });

    document.addEventListener("click", async (event) => {
      const chip = event.target.closest("[data-brief-copy]");
      if (!chip) return;
      event.preventDefault();
      event.stopPropagation();
      const text = chip.dataset.briefCopy || "";
      if (!text) return;
      let ok = false;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          ok = true;
        }
      } catch { ok = false; }
      if (!ok) ok = legacyCopy(text);
      chip.classList.add(ok ? "copied" : "copy-failed");
      setTimeout(() => chip.classList.remove("copied", "copy-failed"), 1200);
    });

    const heatHover = document.querySelector("#heatHover");
    const heatHoverDefault = heatHover?.textContent || "";
    const heatDays = [...document.querySelectorAll("#heatGrid .day")];
    function setDateFilter(date) {
      dateFilter = date || "";
      heatDays.forEach((day) => day.classList.toggle("selected", Boolean(date) && day.dataset.date === date));
      applyFilters();
      if (date) {
        const apps = document.querySelector("#applications");
        if (apps) apps.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
    for (const day of heatDays) {
      day.addEventListener("mouseenter", () => {
        if (!heatHover) return;
        const count = Number(day.dataset.count || 0);
        const noun = count === 1 ? "event" : "events";
        heatHover.textContent = count
          ? day.dataset.date + " · " + count + " " + noun
          : day.dataset.date + " · no events";
      });
      day.addEventListener("mouseleave", () => { if (heatHover) heatHover.textContent = heatHoverDefault; });
      day.addEventListener("click", () => {
        if (!Number(day.dataset.count || 0)) return;
        const next = dateFilter === day.dataset.date ? "" : day.dataset.date;
        setDateFilter(next);
      });
    }
    dateBannerClear?.addEventListener("click", () => setDateFilter(""));

    const resumeMenuToggle = document.querySelector("#resumeMenuToggle");
    const resumeMenu = document.querySelector("#resumeMenu");
    function setResumeMenu(open) {
      if (!resumeMenu || !resumeMenuToggle) return;
      resumeMenu.hidden = !open;
      resumeMenuToggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
    resumeMenuToggle?.addEventListener("click", (event) => {
      event.stopPropagation();
      setResumeMenu(resumeMenu.hidden);
    });
    document.addEventListener("click", (event) => {
      if (!resumeMenu || resumeMenu.hidden) return;
      if (!resumeMenu.contains(event.target) && event.target !== resumeMenuToggle) {
        setResumeMenu(false);
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && resumeMenu && !resumeMenu.hidden) setResumeMenu(false);
    });

    // Force every target="_blank" link through window.open so browsers (Arc in
    // particular) don't override and open same-origin links in the current tab.
    document.querySelectorAll('a[target="_blank"]').forEach((link) => {
      link.addEventListener("click", (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
        event.preventDefault();
        window.open(link.href, "_blank", "noopener,noreferrer");
        if (resumeMenu && !resumeMenu.hidden) setResumeMenu(false);
      });
    });

    const jobsData = JSON.parse(document.querySelector("#jobsData").textContent);
    const drawer = document.querySelector("#drawer");
    const drawerBackdrop = document.querySelector("#drawerBackdrop");
    const drawerTitle = document.querySelector("#drawerTitle");
    const drawerRole = document.querySelector("#drawerRole");
    const drawerStatus = document.querySelector("#drawerStatus");
    const drawerSnapshot = document.querySelector("#drawerSnapshot");
    const drawerBody = document.querySelector("#drawerBody");
    const drawerOpenFile = document.querySelector("#drawerOpenFile");
    const drawerClose = document.querySelector("#drawerClose");
    let activeRow = null;

    function fmtStatus(s) { return String(s || "").replaceAll("_", " "); }
    function statusClassFor(s) { return String(s || "unknown").replace(/[^a-z0-9_-]/gi, "-").toLowerCase(); }
    function escapeAttr(s) { return String(s).replace(/"/g, "&quot;"); }
    function escapeText(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    function shortLink(url) {
      try { const u = new URL(url); return u.hostname.replace(/^www\\./, "") + (u.pathname && u.pathname !== "/" ? u.pathname : ""); }
      catch { return url; }
    }

    function renderSnapshot(job) {
      const rows = [];
      if (job.comp && job.comp !== "Not listed") rows.push(["Comp", escapeText(job.comp)]);
      else if (job.comp === "Not listed") rows.push(["Comp", '<span style="color:var(--muted)">Not listed</span>']);
      if (job.location) rows.push(["Location", escapeText(job.location)]);
      if (job.department) rows.push(["Department", escapeText(job.department)]);
      if (job.employmentType) rows.push(["Type", escapeText(job.employmentType)]);
      if (job.reportsTo) rows.push(["Reports to", escapeText(job.reportsTo)]);
      if (job.link) {
        const display = shortLink(job.link);
        rows.push(["Listing", '<a href="' + escapeAttr(job.link) + '" target="_blank" rel="noopener">' + escapeText(display) + "</a>"]);
      }
      if (!rows.length) {
        drawerSnapshot.hidden = true;
        drawerSnapshot.innerHTML = "";
        return;
      }
      drawerSnapshot.hidden = false;
      drawerSnapshot.innerHTML = rows.map(([k, v]) => "<dt>" + k + "</dt><dd>" + v + "</dd>").join("");
    }

    function openDrawer(index, row) {
      const job = jobsData[index];
      if (!job) return;
      drawerTitle.textContent = job.company || job.name.replace(/\\.md$/, "");
      drawerRole.textContent = job.role || "";
      if (job.status) {
        drawerStatus.hidden = false;
        drawerStatus.textContent = fmtStatus(job.status);
        drawerStatus.className = "pill status-" + statusClassFor(job.status);
      } else {
        drawerStatus.hidden = true;
      }
      renderSnapshot(job);
      drawerBody.innerHTML = job.bodyHtml || "<p class=\\"muted\\">No notes yet.</p>";
      drawerOpenFile.href = job.fileHref;
      drawer.classList.add("open");
      drawer.setAttribute("aria-hidden", "false");
      drawerBackdrop.classList.add("open");
      if (activeRow) activeRow.classList.remove("is-active");
      activeRow = row;
      if (row) row.classList.add("is-active");
    }

    function closeDrawer() {
      drawer.classList.remove("open");
      drawer.setAttribute("aria-hidden", "true");
      drawerBackdrop.classList.remove("open");
      if (activeRow) { activeRow.classList.remove("is-active"); activeRow = null; }
    }

    document.querySelector("#jobsBody").addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      const row = event.target.closest("tr[data-job-index]");
      if (!row) return;
      openDrawer(Number(row.dataset.jobIndex), row);
    });
    drawerBackdrop.addEventListener("click", closeDrawer);
    drawerClose.addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDrawer(); });
  </script>
</body>
</html>`;

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(outFile, html);
  console.log(`Wrote ${outFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
