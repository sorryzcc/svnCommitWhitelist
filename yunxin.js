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
    const required_fields = ['revision', 'user_id', 'user_name', 'branch'];
    const missing = required_fields.filter(field => !(field in request_data));
    if (missing.length > 0) {
      throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }

    const conn = await pool.getConnection();
    try {
      // 检查 Permanent_whitelist 表中是否有匹配的 user_name
      const [permanentRows] = await conn.execute('SELECT * FROM Permanent_whitelist WHERE name = ?', [request_data.user_name]);
      
      if(permanentRows.length > 0) { // 如果找到匹配项
        const response_message = `User ${request_data.user_name} is in the permanent whitelist`;
        const response = {status: 200, message: response_message};
        
        console.log(`Sent Response: ${JSON.stringify(response)}`);
        return res.status(200).json(response);
      } else {
        // 如果没有找到匹配项，则检查 one_time_whitelist 表
        const [rows] = await conn.execute(
          'SELECT * FROM one_time_whitelist WHERE name = ? AND branch = ?',
          [request_data.user_name, request_data.branch || 'trunk']  // 默认分支为trunk
        );

        if(rows.length > 0) { // 如果找到匹配项
          let count = rows[0].count;

          if(count > 0) {
            // 减少计数并更新数据库
            await conn.execute(
              'UPDATE one_time_whitelist SET count = count - 1 WHERE id = ? AND branch = ?',
              [rows[0].id, request_data.branch || 'trunk']
            );
            const remainingUses = count - 1;
            const response_message = `Processed commit by ${request_data.user_name}, remaining uses: ${remainingUses}`;
            const response = {status: 200, message: response_message};

            console.log(`Sent Response: ${JSON.stringify(response)}`);
            return res.status(200).json(response);
          } else {
            // Count is 0, return error
            throw new Error("No remaining uses for this user in the one-time whitelist.");
          }
        } else {
          throw new Error("No matching user found in either the permanent or one-time whitelist.");
        }
      }
    } finally {
      conn.release(); // 释放连接回到连接池
    }
  } catch (error) {
    console.error(error.message);
    return res.status(500).json({status: 500, message: error.message});
  }
});

// 添加一次性白名单的API
app.post('/add-one-time-whitelist', async (req, res) => {
  try {
    const { user_name, branch, count = 1 } = req.body;

    // 验证必填字段
    if (!user_name || !branch) {
      throw new Error('user_name和branch是必填参数');
    }

    const conn = await pool.getConnection();
    try {
      // 检查是否已存在相同用户和分支的记录
      const [existing] = await conn.execute(
        'SELECT * FROM one_time_whitelist WHERE name = ? AND branch = ?',
        [user_name, branch]
      );

      if (existing.length > 0) {
        // 如果已存在，则更新次数
        await conn.execute(
          'UPDATE one_time_whitelist SET count = count + ? WHERE id = ?',
          [count, existing[0].id]
        );
      } else {
        // 如果不存在，则插入新记录
        await conn.execute(
          'INSERT INTO one_time_whitelist (name, branch, count) VALUES (?, ?, ?)',
          [user_name, branch, count]
        );
      }

      const response = {
        status: 200,
        message: `成功为用户 ${user_name} 在分支 ${branch} 上添加 ${count} 次白名单权限`
      };
      return res.status(200).json(response);
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error(error.message);
    return res.status(500).json({status: 500, message: error.message});
  }
});

// GET 路由处理函数
app.get('/', (req, res) => {
  const response = {status: 200, message: "Success"};
  console.log(`Sent Response: ${JSON.stringify(response)}`);
  res.status(200).json(response);
});

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}, accessible from LAN`);
});

// 简单处理程序终止信号以优雅地关闭服务器
process.on('SIGINT', async () => {
  console.log("Shutting down server...");
  await pool.end(); // 异步关闭数据库连接池
  process.exit();
});