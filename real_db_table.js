const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql'); // 引入 mysql 模块
const os = require('os');

// 创建 Express 应用
const app = express();
app.use(bodyParser.json());

// 配置日志
const logger = {
  info: (msg) => console.log(`INFO: ${msg}`),
  error: (msg) => console.error(`ERROR: ${msg}`),
};

// 创建 MySQL 连接池
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

// 更新分支锁定状态的函数
function updateBranchLockStatus(branchName, svn_lock_status) {
  return new Promise((resolve, reject) => {
    const query = 'UPDATE tb_branch_info SET svn_lock_status = ? WHERE svn_branch_name = ?';
    pool.query(query, [svn_lock_status, branchName], (error, results) => {
      if (error) {
        logger.error(`更新分支锁定状态失败：${error.message}`);
        return reject(error);
      }
      if (results.affectedRows > 0) {
        logger.info(`成功更新分支 ${branchName} 的锁定状态为 ${svn_lock_status}`);
        resolve(true);
      } else {
        logger.info(`未找到分支 ${branchName} 或状态未改变`);
        resolve(false);
      }
    });
  });
}

// 定义根路径 POST 请求处理逻辑
app.post('/', async (req, res) => {
  try {
    // 获取请求体
    const body = req.body;
    logger.info(`Received Request Body: ${JSON.stringify(body)}`);

    // 解析请求参数
    const webhookUrl = body.webhook_url || '';
    const chatId = body.chatid || '';
    const textContent = body.text?.content || '';

    // 匹配“锁<分支名>分支”或“解锁<分支名>分支”
    const lockBranchPattern = /(锁|解锁)(\S+)分支/;
    const match = textContent.match(lockBranchPattern);
    if (match) {
      const action = match[1]; // "锁" 或 "解锁"
      const branchName = match[2]; // 分支名称

      // 根据动作设置锁定状态
      const svn_lock_status = action === '锁' ? 1 : 0;

      // 调用分支锁定/解锁逻辑
      const success = await updateBranchLockStatus(branchName, svn_lock_status);

      // 构造回复消息
      let replyMessage = '';
      if (success) {
        replyMessage = `已成功${svn_lock_status === 1 ? '锁定' : '解锁'}分支 ${branchName}`;
      } else {
        replyMessage = `${svn_lock_status === 1 ? '锁定' : '解锁'}分支 ${branchName} 失败，请检查分支是否存在`;
      }

      // 返回响应消息
      res.status(200).json({
        msgtype: 'text',
        text: { content: replyMessage },
      });
      return;
    }

    // 如果没有匹配到分支锁定/解锁指令
    res.status(200).json({
      msgtype: 'text',
      text: { content: '未识别的指令' },
    });
  } catch (err) {
    logger.error(`处理请求时发生错误：${err.message}`);
    res.status(200).json({
      msgtype: 'text',
      text: { content: `处理请求时发生错误：${err.message}` },
    });
  }
});

// 启动服务
const PORT = 8080;
const HOST = '0.0.0.0'; // 监听所有可用的网络接口

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

const server = app.listen(PORT, HOST, () => {
  const addressInfo = server.address();
  const ip = getLocalIPv4Address(); // 获取本地 IPv4 地址
  const port = addressInfo.port;

  logger.info(`服务器已启动，监听地址：http://${ip}:${port}`);
});