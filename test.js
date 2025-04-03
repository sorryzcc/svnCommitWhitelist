const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise'); // 使用promise版本

const app = express();
const PORT = process.argv[2] || 8080;

// 创建数据库连接池配置 - 使用promise版本
const pool = mysql.createPool({
  host: '9.134.107.151',
  user: 'root',
  password: 'xuMwn*6829pBfx',
  port: '3306',
  database: 'svn_tool',
  waitForConnections: true,
  connectionLimit: 10, // 根据实际情况调整
  queueLimit: 0
});

app.use(bodyParser.json());

// POST 路由处理函数
app.post('/', async (req, res) => {
  try {
    const request_data = req.body;
    console.log(`Received Request Body: ${JSON.stringify(request_data)}`);

    // 验证必填字段
    const required_fields = ['revision', 'user_id', 'user_name', 'paths'];
    const missing = required_fields.filter(field => !(field in request_data));
    if (missing.length > 0) {
      throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }

    // 如果 paths 为空，直接返回 200
    if (!Array.isArray(request_data.paths) || request_data.paths.length === 0) {
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
          svn_lock_disposable_whitelist,
          svn_lock_disposable_whitelist_count
        } = branch;

        // 检查当前分支是否在请求的 paths 中
        const isBranchIncluded = request_data.paths.some(path => path.includes(svn_branch_name));
        if (!isBranchIncluded) {
          continue; // 如果当前分支不在请求的 paths 中，跳过
        }

        hasMatchingBranch = true; // 标记有匹配的分支

        // 如果 svn_lock_status 为 0，直接返回 200
        if (svn_lock_status === 0) {
          return res.status(200).json({ status: 200, message: `Branch "${svn_branch_name}" lock status is 0` });
        }

        // 检查 svn_lock_whitelist 是否包含 user_name
        if (svn_lock_whitelist.includes(request_data.user_name)) {
          return res.status(200).json({ status: 200, message: `User "${request_data.user_name}" is in the whitelist for branch "${svn_branch_name}"` });
        }

        // 检查 svn_lock_disposable_whitelist 是否包含 user_name 并且计数大于 0
        if (
          svn_lock_disposable_whitelist.includes(request_data.user_name) &&
          svn_lock_disposable_whitelist_count > 0
        ) {
          // 减少计数并更新数据库
          await conn.execute(
            'UPDATE tb_branch_info SET svn_lock_disposable_whitelist_count = svn_lock_disposable_whitelist_count - 1 WHERE svn_branch_name = ?',
            [svn_branch_name]
          );

          const remainingUses = svn_lock_disposable_whitelist_count - 1;
          return res.status(200).json({
            status: 200,
            message: `Processed commit by ${request_data.user_name} for branch "${svn_branch_name}", remaining uses: ${remainingUses}`
          });
        }

        // 如果条件不满足，返回 403 错误
        throw new Error(`Access denied for branch "${svn_branch_name}"`);
      }

      // 如果没有匹配的分支，直接返回 200
      if (!hasMatchingBranch) {
        return res.status(200).json({ status: 200, message: "No matching branches found, allowing commit." });
      }
    } finally {
      conn.release(); // 释放连接回到连接池
    }
  } catch (error) {
    console.error(error.message);
    return res.status(500).json({ status: 500, message: error.message });
  }
});

// GET 路由处理函数
app.get('/', (req, res) => {
  const response = { status: 200, message: "Success" };
  console.log(`Sent Response: ${JSON.stringify(response)}`);
  res.status(200).json(response);
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// 简单处理程序终止信号以优雅地关闭服务器
process.on('SIGINT', async () => {
  console.log("Shutting down server...");
  await pool.end(); // 异步关闭数据库连接池
  process.exit();
});