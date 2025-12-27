/**
 * ===============================
 * 🎄 Christmas Redeem Backend
 * ===============================
 * 功能：
 * - /health   健康检查
 * - /redeem   验证兑换码 → 返回一次性 token
 * - /download 用 token 下载无水印图片（一次性）
 */

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const cors = require("cors");

const app = express();

/* ===============================
   基础中间件
================================ */
app.use(express.json());

// 开发阶段允许所有域名（稳定后可改成你的前端域名）
app.use(cors({ origin: "*" }));

/* ===============================
   配置
================================ */
const PORT = process.env.PORT || 10000;

// ⚠️ 这是 Render 项目里的真实目录结构
// repo 根目录 /paid/img_paid/1.jpg
const PAID_IMG_DIR = path.join(__dirname, "paid", "img_paid");
const CODES_FILE = path.join(__dirname, "codes.json");

// token 存内存（Render 免费实例重启会清空，这是正常的）
const tokenMap = new Map();
// tokenMap[token] = { img, exp, used }

/* ===============================
   工具函数
================================ */
function safeBasename(name) {
  // 防止 ../ 目录穿越
  return path.basename(name);
}

function readCodes() {
  if (!fs.existsSync(CODES_FILE)) {
    return { codes: [] };
  }
  return JSON.parse(fs.readFileSync(CODES_FILE, "utf-8"));
}

function writeCodes(data) {
  fs.writeFileSync(CODES_FILE, JSON.stringify(data, null, 2), "utf-8");
}

/* ===============================
   根路径 & 健康检查
================================ */
app.get("/", (req, res) => {
  res.send("✅ Backend is running. Use /health /redeem /download");
});

app.get("/health", (req, res) => {
  res.json({ ok: true, msg: "server is running" });
});

/* ===============================
   兑换码验证
   POST /redeem
   body: { code, img }
================================ */
app.post("/redeem", (req, res) => {
  const { code, img } = req.body;

  if (!code || !img) {
    return res.status(400).json({
      ok: false,
      msg: "缺少兑换码或图片参数",
    });
  }

  const imgName = safeBasename(img);
  const paidImgPath = path.join(PAID_IMG_DIR, imgName);

  // 1️⃣ 检查无水印图片是否存在
  if (!fs.existsSync(paidImgPath)) {
    return res.status(404).json({
      ok: false,
      msg: "无水印原图不存在（请检查 paid/img_paid 目录）",
    });
  }

  // 2️⃣ 读取兑换码
  const data = readCodes();
  const item = data.codes.find((c) => c.code === code);

  if (!item) {
    return res.status(401).json({ ok: false, msg: "兑换码无效" });
  }

  if (item.used) {
    return res.status(401).json({ ok: false, msg: "兑换码已被使用" });
  }

  // 3️⃣ 标记兑换码已使用（一码一次）
  item.used = true;
  item.usedAt = new Date().toISOString();
  writeCodes(data);

  // 4️⃣ 生成一次性 token（1 小时有效）
  const token = crypto.randomUUID();
  const exp = Date.now() + 60 * 60 * 1000;

  tokenMap.set(token, {
    img: imgName,
    exp,
    used: false,
  });

  return res.json({
    ok: true,
    msg: "兑换成功！可下载无水印图片（1小时内有效，仅一次）",
    token,
  });
});

/* ===============================
   下载无水印图片
   GET /download?token=xxx&img=1.jpg
================================ */
app.get("/download", (req, res) => {
  const token = req.query.token;
  const img = safeBasename(req.query.img || "");

  if (!token || !img) {
    return res.status(400).send("缺少 token 或 img");
  }

  const record = tokenMap.get(token);

  if (!record) {
    return res.status(401).send("token 无效或已过期");
  }

  if (Date.now() > record.exp) {
    tokenMap.delete(token);
    return res.status(401).send("token 已过期");
  }

  if (record.used) {
    return res.status(401).send("token 已被使用");
  }

  if (record.img !== img) {
    return res.status(401).send("token 与图片不匹配");
  }

  const paidImgPath = path.join(PAID_IMG_DIR, img);

  if (!fs.existsSync(paidImgPath)) {
    return res.status(404).send("文件不存在");
  }

  // 标记 token 已使用（一次性）
  record.used = true;
  tokenMap.set(token, record);

  res.download(paidImgPath, img);
});

/* ===============================
   启动服务
================================ */
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
