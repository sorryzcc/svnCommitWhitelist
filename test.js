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
          svn_lock_disposable_whitelist
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

        // 检查 svn_lock_disposable_whitelist 是否包含 user_name
        if (svn_lock_disposable_whitelist.includes(request_data.user_name)) {
          // 将一次性白名单分割成数组
          let whitelistArray = svn_lock_disposable_whitelist.split(',');

          // 找到第一个匹配的用户并移除
          const index = whitelistArray.indexOf(request_data.user_name);
          if (index !== -1) {
            whitelistArray.splice(index, 1); // 移除一个匹配项
          }

          // 将更新后的一次性白名单重新拼接成字符串
          const updatedWhitelist = whitelistArray.join(',');

          // 更新数据库
          await conn.execute(
            'UPDATE tb_branch_info SET svn_lock_disposable_whitelist = ? WHERE svn_branch_name = ?',
            [updatedWhitelist, svn_branch_name]
          );

          return res.status(200).json({
            status: 200,
            message: `Processed commit by ${request_data.user_name} for branch "${svn_branch_name}", removed one use from disposable whitelist`
          });
        }

        // 如果条件不满足，返回 403 错误
        throw new Error(`您不在 "${svn_branch_name}"分支的永久白名单或者一次性白名单`);
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