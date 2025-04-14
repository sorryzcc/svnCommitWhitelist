const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise'); // 使用 promise 版本
const os = require('os'); // 用于获取网络接口信息

const app = express();
const PORT = process.argv[2] || 8080;

// 创建日志工具
const logger = {
  info: (msg) => console.log(`INFO: ${msg}`),
  error: (msg) => console.error(`ERROR: ${msg}`),
};

// 创建数据库连接池配置 - 使用 promise 版本
const pool = mysql.createPool({
  host: '9.134.107.151',
  user: 'root',
  password: 'xuMwn*6829pBfx',
  port: '3306',
  database: 'svn_tool',
  waitForConnections: true,
  connectionLimit: 10, // 根据实际情况调整
  queueLimit: 0,
});

app.use(bodyParser.json());

// POST 路由处理函数
app.post('/', async (req, res) => {
  try {
    const body = req.body;
    logger.info(`Received Request Body: ${JSON.stringify(body)}`);

    // 解析请求参数
    const { user_name, event_type, paths, message } = body;

    if (!user_name || !event_type) {
      throw new Error("Missing required fields in request body.");
    }

    // 检查是否为 pre-commit 钩子事件
    if (event_type !== "svn_pre_commit") {
      return res.status(200).json({ status: 200, message: "Not a pre-commit event, allowing commit." });
    }

    // 如果 paths 为空，直接允许提交
    if (!Array.isArray(paths) || paths.length === 0) {
      return res.status(200).json({ status: 200, message: "No branches to check, allowing commit." });
    }

    const conn = await pool.getConnection();
    try {
      // 查询 tb_branch_info 表，获取所有分支信息
      const [branchRows] = await conn.execute('SELECT * FROM tb_branch_info');

      let hasMatchingBranch = false; // 标记是否有匹配的分支

      for (const branch of branchRows) {
        const {
          svn_branch_name,
          svn_lock_status,
          svn_lock_whitelist,
          svn_lock_disposable_whitelist
        } = branch;

        // 检查当前分支是否在请求的 paths 中
        const isBranchIncluded = paths.some(path => path.includes(svn_branch_name));
        if (!isBranchIncluded) {
          continue; // 如果当前分支不在请求的 paths 中，跳过
        }

        hasMatchingBranch = true; // 标记有匹配的分支

        // 如果 svn_lock_status 为 0，直接返回 200
        if (svn_lock_status === 0) {
          return res.status(200).json({ status: 200, message: `Branch "${svn_branch_name}" lock status is 0` });
        }

        // 检查 svn_lock_whitelist 是否包含 user_name
        if (svn_lock_whitelist.split(',').filter(Boolean).includes(user_name)) {
          return res.status(200).json({ status: 200, message: `User "${user_name}" is in the whitelist for branch "${svn_branch_name}"` });
        }

        // 检查 svn_lock_disposable_whitelist 是否包含 user_name
        const disposableWhitelistArray = svn_lock_disposable_whitelist.split(',').filter(Boolean);
        const index = disposableWhitelistArray.indexOf(user_name);
        if (index !== -1) {
          disposableWhitelistArray.splice(index, 1); // 移除用户
          const updatedWhitelist = disposableWhitelistArray.join(',');

          // 更新数据库
          await conn.execute(
            'UPDATE tb_branch_info SET svn_lock_disposable_whitelist = ? WHERE svn_branch_name = ?',
            [updatedWhitelist, svn_branch_name]
          );

          return res.status(200).json({
            status: 200,
            message: `Processed commit by ${user_name} for branch "${svn_branch_name}", removed one use from disposable whitelist`
          });
        }

        // 如果条件不满足，返回 403 错误
        throw new Error(`您不在 "${svn_branch_name}" 分支的永久白名单或者一次性白名单`);
      }

      // 如果没有匹配的分支，直接返回 200
      if (!hasMatchingBranch) {
        return res.status(200).json({ status: 200, message: "No matching branches found, allowing commit." });
      }
    } finally {
      conn.release(); // 释放连接回到连接池
    }
  } catch (error) {
    logger.error(error.message);
    return res.status(500).json({ status: 500, message: error.message });
  }
});

// 获取本机的 IPv4 地址
function getLocalIPv4Address() {
  const interfaces = os.networkInterfaces(); // 获取所有网络接口
  for (const interfaceName in interfaces) {
    const iface = interfaces[interfaceName];
    for (const alias of iface) {
      if (alias.family === 'IPv4' && !alias.internal) {
        // 找到非内部（非回环）的 IPv4 地址
        return alias.address;
      }
    }
  }
  return '127.0.0.1'; // 如果没有找到合适的 IPv4 地址，则返回 localhost
}

// 启动服务器
const server = app.listen(PORT, () => {
  const ip = getLocalIPv4Address(); // 获取本地 IPv4 地址
  const port = server.address().port;

  logger.info(`服务器已启动，监听地址：http://${ip}:${port}`);
});

// 简单处理程序终止信号以优雅地关闭服务器
process.on('SIGINT', async () => {
  logger.info("Shutting down server...");
  await pool.end(); // 异步关闭数据库连接池
  process.exit();
});