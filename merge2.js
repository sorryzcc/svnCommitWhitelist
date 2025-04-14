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

// 更新分支锁定状态的函数
async function updateBranchLockStatus(branchName, svn_lock_status) {
  const query = 'UPDATE tb_branch_info SET svn_lock_status = ? WHERE svn_branch_name = ?';
  try {
    const [results] = await pool.execute(query, [svn_lock_status, branchName]);
    if (results.affectedRows > 0) {
      logger.info(`成功更新分支 ${branchName} 的锁定状态为 ${svn_lock_status}`);
      return true;
    } else {
      logger.info(`未找到分支 ${branchName} 或状态未改变`);
      return false;
    }
  } catch (error) {
    logger.error(`更新分支锁定状态失败：${error.message}`);
    throw error;
  }
}

// 增加一次性白名单的函数
async function addDisposableWhitelist(branchName, whitelistUser) {
  const checkQuery = 'SELECT svn_lock_disposable_whitelist FROM tb_branch_info WHERE svn_branch_name = ?';
  try {
    const [checkResults] = await pool.execute(checkQuery, [branchName]);
    if (checkResults.length === 0) {
      logger.info(`分支 ${branchName} 不存在，无法增加一次性白名单`);
      return false;
    }

    let currentWhitelist = checkResults[0].svn_lock_disposable_whitelist || '';
    const whitelistArray = currentWhitelist.split(',').filter(Boolean);

    if (!whitelistArray.includes(whitelistUser)) {
      whitelistArray.push(whitelistUser);
    }

    const updatedWhitelist = whitelistArray.join(',');
    const updateQuery = 'UPDATE tb_branch_info SET svn_lock_disposable_whitelist = ? WHERE svn_branch_name = ?';
    const [updateResults] = await pool.execute(updateQuery, [updatedWhitelist, branchName]);

    if (updateResults.affectedRows > 0) {
      logger.info(`成功为分支 ${branchName} 增加一次性白名单用户 ${whitelistUser}`);
      return true;
    } else {
      logger.info(`未能为分支 ${branchName} 增加一次性白名单用户 ${whitelistUser}`);
      return false;
    }
  } catch (error) {
    logger.error(`增加一次性白名单失败：${error.message}`);
    throw error;
  }
}

// 处理 Web 钩子请求的函数
async function handleWebhookRequest(reqBody) {
  const { user_name, paths } = reqBody;

  if (!Array.isArray(paths) || paths.length === 0) {
    return { status: 200, message: "No branches to check, allowing commit." };
  }

  const conn = await pool.getConnection();
  try {
    // 查询 tb_branch_info 表，获取所有分支信息
    const [branchRows] = await conn.execute('SELECT * FROM tb_branch_info');

    let hasMatchingBranch = false; // 标记是否有匹配的分支
    let responseMessages = []; // 存储所有分支的响应消息

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

      // 如果 svn_lock_status 为 0，直接允许提交
      if (svn_lock_status === 0) {
        responseMessages.push(`分支 "${svn_branch_name}" 锁定状态为 0，允许提交`);
        continue;
      }

      // 检查 svn_lock_whitelist 是否包含 user_name
      if (svn_lock_whitelist.split(',').filter(Boolean).includes(user_name)) {
        responseMessages.push(`用户 "${user_name}" 在永久白名单中，允许提交分支 "${svn_branch_name}"`);
        continue;
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

        responseMessages.push(`用户 "${user_name}" 在一次性白名单中，已移除并允许提交分支 "${svn_branch_name}"`);
        continue;
      }

      // 如果以上条件都不满足，则拒绝提交
      responseMessages.push(`分支 "${svn_branch_name}" 锁定状态为 1，且用户 "${user_name}" 不在白名单中，拒绝提交`);
    }

    // 如果没有任何匹配的分支，直接允许提交
    if (!hasMatchingBranch) {
      return { status: 200, message: "No matching branches found, allowing commit." };
    }

    // 返回所有分支的响应消息
    return { status: 200, messages: responseMessages };
  } finally {
    conn.release();
  }
}

// POST 路由处理函数
app.post('/', async (req, res) => {
  try {
    const body = req.body;
    logger.info(`Received Request Body: ${JSON.stringify(body)}`);

    // 判断是机器人请求还是 Web 钩子请求
    if (body.from && body.webhook_url) {
      // 处理机器人请求
      const textContent = body.text?.content || '';
      const user_name = body.from?.userid || '';

      // 匹配“锁<分支名>分支”或“解锁<分支名>分支”
      const lockBranchPattern = /(锁|解锁)(\S+)分支/;
      const lockMatch = textContent.match(lockBranchPattern);

      // 匹配“增加一次性白名单”指令
      const disposableWhitelistPattern = /(\S+)分支增加一次性白名单(\S+)/;
      const disposableWhitelistMatch = textContent.match(disposableWhitelistPattern);

      if (lockMatch) {
        // 处理分支锁定/解锁逻辑
        const action = lockMatch[1]; // "锁" 或 "解锁"
        const branchName = lockMatch[2]; // 分支名称

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

        return res.status(200).json({ msgtype: 'text', text: { content: replyMessage } });
      } else if (disposableWhitelistMatch) {
        // 处理增加一次性白名单逻辑
        const branchName = disposableWhitelistMatch[1]; // 分支名称
        const whitelistUser = disposableWhitelistMatch[2]; // 白名单用户

        // 调用增加一次性白名单逻辑
        const success = await addDisposableWhitelist(branchName, whitelistUser);

        // 构造回复消息
        let replyMessage = '';
        if (success) {
          replyMessage = `已成功为分支 ${branchName} 增加一次性白名单用户 ${whitelistUser}`;
        } else {
          replyMessage = `为分支 ${branchName} 增加一次性白名单用户 ${whitelistUser} 失败，请检查分支或用户信息`;
        }

        return res.status(200).json({ msgtype: 'text', text: { content: replyMessage } });
      }

      // 如果没有匹配到任何指令，返回默认消息
      return res.status(200).json({ msgtype: 'text', text: { content: '未识别的指令，请重新输入。' } });
    } else if (body.user_name && body.operation_kind && body.event_type) {
      // 处理 Web 钩子请求
      const result = await handleWebhookRequest(body);
      return res.status(result.status).json(result);
    } else {
      // 未知请求类型
      return res.status(400).json({ status: 400, message: "Unknown request type." });
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