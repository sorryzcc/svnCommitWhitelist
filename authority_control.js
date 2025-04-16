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
async function updateBranchLockStatus(branchIdentifier, svn_lock_status) {
    const query = 'UPDATE tb_branch_info SET svn_lock_status = ? WHERE svn_branch_name = ? OR alias = ?';
    try {
        const [results] = await pool.execute(query, [svn_lock_status, branchIdentifier, branchIdentifier]);
        if (results.affectedRows > 0) {
            logger.info(`成功更新分支 ${branchIdentifier} 的锁定状态为 ${svn_lock_status}`);
            return true;
        } else {
            logger.info(`未找到分支 ${branchIdentifier} 或状态未改变`);
            return false;
        }
    } catch (error) {
        logger.error(`更新分支锁定状态失败：${error.message}`);
        throw error;
    }
}

// 增加一次性白名单的函数
async function addDisposableWhitelist(branchIdentifier, whitelistUser) {
    const checkQuery = 'SELECT svn_lock_disposable_whitelist FROM tb_branch_info WHERE svn_branch_name = ? OR alias = ?';
    try {
        const [checkResults] = await pool.execute(checkQuery, [branchIdentifier, branchIdentifier]);
        if (checkResults.length === 0) {
            logger.info(`分支 ${branchIdentifier} 不存在，无法增加一次性白名单`);
            return false;
        }

        let currentWhitelist = checkResults[0].svn_lock_disposable_whitelist || '';
        const whitelistArray = currentWhitelist.split(',').filter(Boolean);

        whitelistArray.push(whitelistUser);

        const updatedWhitelist = whitelistArray.join(',');
        const updateQuery = 'UPDATE tb_branch_info SET svn_lock_disposable_whitelist = ? WHERE svn_branch_name = ? OR alias = ?';
        const [updateResults] = await pool.execute(updateQuery, [updatedWhitelist, branchIdentifier, branchIdentifier]);

        if (updateResults.affectedRows > 0) {
            logger.info(`成功为分支 ${branchIdentifier} 增加一次性白名单用户 ${whitelistUser}`);
            return true;
        } else {
            logger.info(`未能为分支 ${branchIdentifier} 增加一次性白名单用户 ${whitelistUser}`);
            return false;
        }
    } catch (error) {
        logger.error(`增加一次性白名单失败：${error.message}`);
        throw error;
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
            const userAlias = body.from.alias; // 请求者的 alias

            // 匹配“锁库 分支名”指令
            const lockPattern = /lock\s+(\S+)/;
            const lockMatch = textContent.match(lockPattern);

            // 匹配“开闸 分支名”指令
            const unlockAllPattern = /unlockall\s+(\S+)/;
            const unlockAllMatch = textContent.match(unlockAllPattern);

            // 匹配“增加一次性白名单 分支名 用户名”指令
            const disposableWhitelistPattern = /unlock\s+(\S+)\s+@(\S+)(?:$([^)]+)$)?/;
            const disposableWhitelistMatch = textContent.match(disposableWhitelistPattern);

            // 查询请求者的永久白名单权限
            const checkPermissionQuery = 'SELECT svn_lock_whitelist FROM tb_branch_info WHERE svn_lock_whitelist LIKE ? LIMIT 1';
            const [permissionResults] = await pool.execute(checkPermissionQuery, [`%${userAlias}%`]);

            if (permissionResults.length === 0) {
                logger.info(`请求者 ${userAlias} 不在任何分支的永久白名单中，无权操作`);
                return res.status(200).json({
                    msgtype: 'text',
                    text: {
                        content: `${userAlias} 不在永久白名单内，无权执行此操作。`
                    }
                });
            }

            if (lockMatch) {
                // 处理分支锁定逻辑
                const branchIdentifier = lockMatch[1].trim(); // 分支名称或别名

                // 设置锁定状态为 1（锁定）
                const success = await updateBranchLockStatus(branchIdentifier, 1);

                // 构造回复消息
                let replyMessage = '';
                if (success) {
                    replyMessage = `已成功锁定分支 ${branchIdentifier}`;
                } else {
                    replyMessage = `锁定分支 ${branchIdentifier} 失败，请检查分支是否存在`;
                }

                return res.status(200).json({ msgtype: 'text', text: { content: replyMessage } });
            } else if (unlockAllMatch) {
                // 处理分支解锁逻辑
                const branchIdentifier = unlockAllMatch[1].trim(); // 分支名称或别名

                // 设置锁定状态为 0（解锁）
                const success = await updateBranchLockStatus(branchIdentifier, 0);

                // 构造回复消息
                let replyMessage = '';
                if (success) {
                    replyMessage = `已成功解锁分支 ${branchIdentifier}`;
                } else {
                    replyMessage = `解锁分支 ${branchIdentifier} 失败，请检查分支是否存在`;
                }

                return res.status(200).json({ msgtype: 'text', text: { content: replyMessage } });
            } else if (disposableWhitelistMatch) {
                // 处理增加一次性白名单逻辑
                const branchIdentifier = disposableWhitelistMatch[1].trim(); // 分支名称或别名
                const targetUserAlias = disposableWhitelistMatch[2].trim(); // 目标用户标识
                const targetUserName = disposableWhitelistMatch[3]?.trim() || ''; // 目标用户名（可选）

                // 调用增加一次性白名单逻辑
                const success = await addDisposableWhitelist(branchIdentifier, targetUserAlias);

                // 构造回复消息
                let replyMessage = '';
                if (success) {
                    replyMessage = `已成功为分支 ${branchIdentifier} 增加一次性白名单用户 ${targetUserName ? `${targetUserName}(${targetUserAlias})` : targetUserAlias}`;
                } else {
                    replyMessage = `为分支 ${branchIdentifier} 增加一次性白名单用户 ${targetUserName ? `${targetUserName}(${targetUserAlias})` : targetUserAlias} 失败，请检查分支或用户信息`;
                }

                return res.status(200).json({ msgtype: 'text', text: { content: replyMessage } });
            }

            // 如果没有匹配到任何指令，返回默认消息
            return res.status(200).json({
                msgtype: 'text',
                text: {
                    content: `未识别的指令，请重新输入。\n示例：\n@svn机器人 lock b02rel\n@svn机器人 unlockall b02rel\n@svn机器人 unlock b02rel @v_zccgzhang(张匆匆)`
                }
            });
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