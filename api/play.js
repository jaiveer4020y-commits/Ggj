export const config = {
  runtime: "nodejs",
};

import crypto from "crypto";

const DOMAIN = "https://watchout.rpmvid.com";
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";

const KEY = Buffer.from("6b69656d7469656e6d75613931316361", "hex");
const IV = Buffer.from("313233343536373839306f6975797472", "hex");

/* ───────── helpers ───────── */

async function getVideoId(title) {
  const url = `https://hlsworker.watchoutofficial2006.workers.dev/?title=${encodeURIComponent(
    title
  )}`;
  const r = await fetch(url);
  const j = await r.json();
  return j?.result?.files?.[0]?.file_code;
}

function decrypt(hex) {
  const decipher = crypto.createDecipheriv("aes-128-cbc", KEY, IV);
  const buf = Buffer.concat([
    decipher.update(Buffer.from(hex, "hex")),
    decipher.final(),
  ]);
  return JSON.parse(buf.toString());
}

async function extractM3U8(id) {
  const r = await fetch(`${DOMAIN}/api/v1/video?id=${id}`, {
    headers: { Referer: DOMAIN, "User-Agent": UA },
  });
  const enc = await r.text();
  return decrypt(enc).source;
}

function rewrite(m3u8, base, host) {
  const p = (u) =>
    `${host}/api/play?proxy=1&url=${encodeURIComponent(u)}`;

  return m3u8
    .replace(/URI="([^"]+)"/g, (_, u) => `URI="${p(new URL(u, base))}"`)
    .replace(
      /^(?!#)(.*\.(m3u8|ts|m4s).*)$/gm,
      (m) => p(new URL(m, base))
    );
}

/* ───────── handler ───────── */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  /* segment proxy */
  if (req.query.proxy && req.query.url) {
    const u = decodeURIComponent(req.query.url);
    const r = await fetch(u, {
      headers: { Referer: DOMAIN, Origin: DOMAIN, "User-Agent": UA },
    });

    const ct = r.headers.get("content-type") || "";
    if (ct.includes("mpegurl")) {
      let t = await r.text();
      t = rewrite(
        t,
        u.substring(0, u.lastIndexOf("/") + 1),
        `https://${req.headers.host}`
      );
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      return res.send(t);
    }

    res.setHeader("Content-Type", ct);
    return res.send(Buffer.from(await r.arrayBuffer()));
  }

  /* auto extract */
  let id = req.query.video_id;
  if (!id && req.query.title) id = await getVideoId(req.query.title);
  if (!id) return res.status(400).send("Missing title or video_id");

  const m3u8 = await extractM3U8(id);
  const base = m3u8.substring(0, m3u8.lastIndexOf("/") + 1);

  const proxied = rewrite(
    await (await fetch(m3u8)).text(),
    base,
    `https://${req.headers.host}`
  );

  res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
  res.send(proxied);
}
