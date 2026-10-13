import { existsSync } from "node:fs";
import { Store } from "./store.js";
import { bootstrap } from "./seed.js";
if (existsSync(".env")) process.loadEnvFile(".env");
const {
  BOOTSTRAP_NAME: name,
  BOOTSTRAP_EMAIL: email,
  BOOTSTRAP_PASSWORD: password,
} = process.env;
if (!name || !email || !password || password.length < 12)
  throw new Error("请配置企业名称、管理员邮箱及至少 12 位初始密码");
const store = new Store(process.env.DATABASE_PATH || ".runtime/mengine.db");
try {
  const u = bootstrap(store, name, email, password);
  console.log(`企业创建成功：${name}，账号 ${u.email}`);
} finally {
  store.close();
}
