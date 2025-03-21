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
    const required_fields = ['revision', 'user_id'];
    const missing = required_fields.filter(field => !(field in request_data));
    if (missing.length > 0) {
      throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }

    // 获取数据库连接并查询是否存在匹配的user_name
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.execute('SELECT * FROM one_time_whitelist WHERE name = ?', [request_data.user_name]);
      
      if(rows.length > 0) { // 如果找到匹配项
        // 删除匹配的记录
        await conn.execute('DELETE FROM one_time_whitelist WHERE id = ?', [rows[0].id]);

        const response_message = `Processed commit by ${request_data.user_name}`;
        const response = {status: 200, message: response_message};

        console.log(`Sent Response: ${JSON.stringify(response)}`);
        return res.status(200).json(response);
      } else {
        throw new Error("No matching user found in the database.");
      }
    } finally {
      conn.release(); // 释放连接回到连接池
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
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// 简单处理程序终止信号以优雅地关闭服务器
process.on('SIGINT', async () => {
  console.log("Shutting down server...");
  await pool.end(); // 异步关闭数据库连接池
  process.exit();
});