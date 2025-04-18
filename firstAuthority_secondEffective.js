const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise'); // 使用 promise 版本
const os = require('os'); // 用于获取网络接口信息
const logger = require('./logger.js')

const app = express();
const PORT = process.argv[2] || 8080;

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
      logger.info(`从数据库中查询到的分支信息：${JSON.stringify(branchRows)}`);
  
      let hasMatchingBranch = false; // 标记是否有匹配的分支
      let responseMessages = []; // 存储所有分支的响应消息
  
      for (const branch of branchRows) {
        const {
          svn_branch_name,
          alias,
          svn_lock_status,
          svn_lock_whitelist,
          svn_lock_disposable_whitelist
        } = branch;
  
        // 检查当前分支是否在请求的 paths 中
        const isBranchIncluded = paths.some(path => path.includes(svn_branch_name) || path.includes(alias));
        if (!isBranchIncluded) {
          logger.info(`分支 "${svn_branch_name}" (${alias}) 不在请求的 paths 中，跳过检查`);
          continue; // 如果当前分支不在请求的 paths 中，跳过
        }
  
        hasMatchingBranch = true; // 标记有匹配的分支
        logger.info(`正在检查分支 "${svn_branch_name}" (${alias}) 的锁定状态`);
  
        // 如果 svn_lock_status 为 0，直接允许提交
        if (svn_lock_status === 0) {
          responseMessages.push(`分支 "${svn_branch_name}" (${alias}) 锁定状态为 0，允许提交`);
          logger.info(`分支 "${svn_branch_name}" (${alias}) 锁定状态为 0，允许提交`);
          continue;
        }
  
        // 检查 svn_lock_whitelist 是否包含 user_name
        if (svn_lock_whitelist.split(',').filter(Boolean).includes(user_name)) {
          responseMessages.push(`用户 "${user_name}" 在永久白名单中，允许提交分支 "${svn_branch_name}" (${alias})`);
          logger.info(`用户 "${user_name}" 在永久白名单中，允许提交分支 "${svn_branch_name}" (${alias})`);
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
            'UPDATE tb_branch_info SET svn_lock_disposable_whitelist = ? WHERE svn_branch_name = ? OR alias = ?',
            [updatedWhitelist, svn_branch_name, alias]
          );
  
          responseMessages.push(`用户 "${user_name}" 在一次性白名单中，已移除并允许提交分支 "${svn_branch_name}" (${alias})`);
          logger.info(`用户 "${user_name}" 在一次性白名单中，已移除并允许提交分支 "${svn_branch_name}" (${alias})`);
          continue;
        }
  
        // 如果以上条件都不满足，则拒绝提交
        responseMessages.push(`分支 "${svn_branch_name}" (${alias}) 锁定状态为 1，且用户 "${user_name}" 不在白名单中，拒绝提交`);
        logger.error(`分支 "${svn_branch_name}" (${alias}) 锁定状态为 1，且用户 "${user_name}" 不在白名单中，拒绝提交`);
        return { status: 500, message: `提交被拒绝：分支 "${svn_branch_name}" (${alias}) 已锁定，且用户 "${user_name}" 不在白名单中。` };
      }
  
      // 如果没有任何匹配的分支，直接允许提交
      if (!hasMatchingBranch) {
        logger.info("没有匹配的分支，允许提交");
        return { status: 200, message: "No matching branches found, allowing commit." };
      }
  
      // 返回所有分支的响应消息
      logger.info(`所有分支的响应消息：${responseMessages}`);
      return { status: 200, messages: responseMessages };
    } catch (error) {
      logger.error(`处理 Web 钩子请求时发生错误：${error.message}`);
      return { status: 500, message: error.message };
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
            let textContent = body.text?.content || '';
            logger.info(`Text Content Received: ${textContent}`);

            // 去掉指令前的“@svn机器人”部分
            textContent = textContent.replace(/^@svn机器人\s*/, '').trim();
            logger.info(`Processed Text Content: ${textContent}`);

            const userAlias = body.from.alias; // 请求者的 alias

            // **第一步：查询所有分支的永久白名单**
            const checkAllPermissionsQuery = `
                SELECT alias, svn_lock_whitelist 
                FROM tb_branch_info
            `;
            const [allPermissionResults] = await pool.execute(checkAllPermissionsQuery);

            // 将所有分支的白名单信息存储为一个对象，方便快速查找
            const allWhitelists = {};
            for (const row of allPermissionResults) {
                allWhitelists[row.alias] = row.svn_lock_whitelist.split(',').map(item => item.trim());
            }
            logger.info(`Parsed All Whitelists: ${JSON.stringify(allWhitelists)}`);

            // **第二步：检查用户是否在任意分支的白名单中**
            let isUserInAnyWhitelist = false;
            let branchIdentifier = null;

            for (const [alias, whitelistArray] of Object.entries(allWhitelists)) {
                if (whitelistArray.includes(userAlias)) {
                    isUserInAnyWhitelist = true;
                    branchIdentifier = alias; // 记录用户所在的分支
                    break;
                }
            }

            // 如果用户不在任何分支的白名单中，直接返回错误消息
            if (!isUserInAnyWhitelist) {
                logger.info(`请求者 ${userAlias} 不在任何分支的永久白名单中，无权操作`);
                return res.status(200).json({
                    msgtype: 'text',
                    text: {
                        content: `${userAlias} 不在任何分支的永久白名单内，无权执行此操作。`
                    }
                });
            }

            logger.info(`请求者 ${userAlias} 在分支 ${branchIdentifier} 的永久白名单中`);

            // **第三步：提取分支标识符**
            const branchPattern = /^(\S+)/;
            const branchMatch = textContent.match(branchPattern);

            // 如果没有匹配到分支标识符，直接返回错误消息
            if (!branchMatch) {
                return res.status(200).json({
                    msgtype: 'text',
                    text: {
                        content: `未识别的指令，请重新输入。\n示例：\n lock b01rel\n unlockall b01rel\n unlock b01rel @v_zccgzhang(张匆匆)`
                    }
                });
            }

            const extractedBranchIdentifier = branchMatch[0].trim(); // 提取的分支标识符
            logger.info(`Extracted Branch Identifier: ${extractedBranchIdentifier}`);

            // 检查提取的分支是否与用户所在分支一致
            if (extractedBranchIdentifier !== branchIdentifier) {
                logger.info(`请求者 ${userAlias} 尝试操作非所属分支 ${extractedBranchIdentifier}`);
                return res.status(200).json({
                    msgtype: 'text',
                    text: {
                        content: `${userAlias} 仅允许操作分支 ${branchIdentifier}，无法操作分支 ${extractedBranchIdentifier}。`
                    }
                });
            }

            // 用户在白名单中，继续解析指令
            logger.info(`User ${userAlias} is in the whitelist. Proceeding to parse the command.`);

            // 匹配“锁库 分支名”指令
            const lockPattern = /^lock\s+(\S+)/;
            const lockMatch = textContent.match(lockPattern);

            // 匹配“开闸 分支名”指令
            const unlockAllPattern = /^unlockall\s+(\S+)/;
            const unlockAllMatch = textContent.match(unlockAllPattern);

            // 匹配“增加一次性白名单 分支名 用户名”指令
            const disposableWhitelistPattern = /^unlock\s+(\S+)\s+@(\S+)(?:$([^)]+)$)?/;
            const disposableWhitelistMatch = textContent.match(disposableWhitelistPattern);

            // 根据指令类型执行对应逻辑
            if (lockMatch) {
                // 处理分支锁定逻辑
                const success = await updateBranchLockStatus(branchIdentifier, 1);
                const replyMessage = success
                    ? `已成功锁定分支 ${branchIdentifier}`
                    : `锁定分支 ${branchIdentifier} 失败，请检查分支是否存在`;
                return res.status(200).json({ msgtype: 'text', text: { content: replyMessage } });

            } else if (unlockAllMatch) {
                // 处理分支解锁逻辑
                const success = await updateBranchLockStatus(branchIdentifier, 0);
                const replyMessage = success
                    ? `已成功解锁分支 ${branchIdentifier}`
                    : `解锁分支 ${branchIdentifier} 失败，请检查分支是否存在`;
                return res.status(200).json({ msgtype: 'text', text: { content: replyMessage } });

            } else if (disposableWhitelistMatch) {
                // 提取目标用户信息
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

            } else {
                // 无效指令
                return res.status(200).json({
                    msgtype: 'text',
                    text: {
                        content: `未识别的指令，请重新输入。\n示例：\n lock b01rel\n unlockall b01rel\n unlock b01rel @v_zccgzhang(张匆匆)`
                    }
                });
            }

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