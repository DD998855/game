const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
app.use(express.json());

// ====== 配置（按你的文件结构）======
const PORT = 5500;
const ROOT_DIR = __dirname; // CHRISTMAS 根目录
const PRIVATE_IMG_DIR = path.join(ROOT_DIR, "paid", "img_paid"); // paid/img_paid/*.jpg
const CODES_FILE = path.join(ROOT_DIR, "codes.json");

// token 存内存：一次性、会过期
// tokenMap[token] = { img: "6.jpg", exp: 123..., used: false }
const tokenMap = new Map();

// ====== 工具函数 ======
function readCodes() {
  const raw = fs.readFileSync(CODES_FILE, "utf-8");
  return JSON.parse(raw);
}
function writeCodes(data) {
  fs.writeFileSync(CODES_FILE, JSON.stringify(data, null, 2), "utf-8");
}
function safeBasename(file) {
  return path.basename(file || "");
}

// ====== 静态资源：把整个项目当作静态站点 ======
app.use(express.static(ROOT_DIR));

// ====== 兑换码验证：成功后发一次性 token ======
app.post("/redeem", (req, res) => {
  const { code, img } = req.body;

  if (!code || !img) {
    return res.status(400).json({ ok: false, msg: "缺少 code 或 img" });
  }

  const imgName = safeBasename(img); // e.g. "6.jpg"

  // 检查无水印原图是否存在
  const paidImgPath = path.join(PRIVATE_IMG_DIR, imgName);
  if (!fs.existsSync(paidImgPath)) {
    return res.status(404).json({
      ok: false,
      msg: "无水印原图不存在：请检查 paid/img_paid 里是否有 " + imgName
    });
  }

  const data = readCodes();
  const item = data.codes.find((c) => c.code === code);

  if (!item) {
    return res.status(401).json({ ok: false, msg: "兑换码无效" });
  }
  if (item.used) {
    return res.status(401).json({ ok: false, msg: "兑换码已被使用" });
  }

  // 标记已使用（一码一次）
  item.used = true;
  item.usedAt = new Date().toISOString();
  writeCodes(data);

  // 生成 token（5分钟过期）
  const token = crypto.randomUUID();
  const exp = Date.now() + 5 * 60 * 1000;

  tokenMap.set(token, { img: imgName, exp, used: false });

  return res.json({
    ok: true,
    msg: "兑换成功！已解锁无水印下载（5分钟内有效，仅一次）",
    token
  });
});

// ====== 下载无水印：必须 token + img，且一次性 ======
app.get("/download", (req, res) => {
  const token = req.query.token;
  const img = safeBasename(req.query.img);

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
    return res.status(401).send("该 token 已被使用");
  }
  if (record.img !== img) {
    return res.status(401).send("token 与图片不匹配");
  }

  const paidImgPath = path.join(PRIVATE_IMG_DIR, img);
  if (!fs.existsSync(paidImgPath)) {
    return res.status(404).send("文件不存在");
  }

  // 标记 token 已使用（一次性）
  record.used = true;
  tokenMap.set(token, record);

  // 强制下载
  res.download(paidImgPath, `christmas_paid_${img}`);
});

// ====== 启动 ======
app.listen(PORT, () => {
  console.log(`✅ Server running: http://127.0.0.1:${PORT}/index.html`);
  console.log(`✅ Paid images: ${PRIVATE_IMG_DIR}`);
});
