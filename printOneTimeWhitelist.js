const mysql = require('mysql2');

// 创建数据库连接配置
const connection = mysql.createConnection({
  host: '9.134.107.151',
  user: 'root',
  password: 'xuMwn*6829pBfx',
  port: '3306',
  database: 'svn_tool'
});

// 连接到数据库
connection.connect((err) => {
  if (err) {
    console.error('数据库连接失败:', err.stack);
    return;
  }
  console.log('成功连接到数据库');
  
  // 查询one_time_whitelist表的内容
  const query = 'SELECT * FROM one_time_whitelist';
  connection.query(query, (error, results, fields) => {
    if (error) throw error;
    
    // 打印查询结果
    console.log(results);
  });

  // 关闭数据库连接
  connection.end();
});