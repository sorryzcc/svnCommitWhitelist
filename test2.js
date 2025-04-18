const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise'); // 使用 promise 版本
const os = require('os'); // 用于获取网络接口信息
const logger = require('./logger.js')

const app = express();
const PORT = process.argv[2] || 8080;

// 创建日志工具
// const logger = {
//   info: (msg) => console.log(`INFO: ${msg}`),
//   error: (msg) => console.error(`ERROR: ${msg}`),
// };

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
  const connection = await pool.getConnection(); // 获取数据库连接
  try {
      await connection.beginTransaction(); // 开始事务

      const checkQuery = `
          SELECT svn_lock_disposable_whitelist 
          FROM tb_branch_info 
          WHERE svn_branch_name = ? OR alias = ?
          FOR UPDATE
      `;
      const [checkResults] = await connection.execute(checkQuery, [branchIdentifier, branchIdentifier]);

      if (checkResults.length === 0) {
          logger.info(`分支 ${branchIdentifier} 不存在，无法增加一次性白名单`);
          await connection.rollback(); // 回滚事务
          return false;
      }

      let currentWhitelist = checkResults[0].svn_lock_disposable_whitelist || '';
      logger.info(`当前一次性白名单内容（原始）: "${currentWhitelist}"`);

      const whitelistArray = currentWhitelist.split(',').filter(Boolean).map(item => item.trim());
      logger.info(`当前一次性白名单内容（数组）: ${JSON.stringify(whitelistArray)}`);

      // 添加新用户到白名单（允许重复）
      whitelistArray.push(whitelistUser);
      const updatedWhitelist = whitelistArray.join(',');

      const updateQuery = `
          UPDATE tb_branch_info 
          SET svn_lock_disposable_whitelist = ? 
          WHERE svn_branch_name = ? OR alias = ?
      `;
      const [updateResults] = await connection.execute(updateQuery, [updatedWhitelist, branchIdentifier, branchIdentifier]);

      if (updateResults.affectedRows > 0) {
          logger.info(`成功为分支 ${branchIdentifier} 增加一次性白名单用户 ${whitelistUser}`);
          await connection.commit(); // 提交事务
          return true;
      } else {
          logger.info(`未能为分支 ${branchIdentifier} 增加一次性白名单用户 ${whitelistUser}`);
          await connection.rollback(); // 回滚事务
          return false;
      }
  } catch (error) {
      logger.error(`为分支 ${branchIdentifier} 增加一次性白名单用户 ${whitelistUser} 时发生错误：${error.message}`);
      await connection.rollback(); // 回滚事务
      throw error;
  } finally {
      connection.release(); // 释放数据库连接
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

            // 处理一次性白名单
            const disposableWhitelistArray = svn_lock_disposable_whitelist
                .split(',')
                .filter(Boolean)
                .map(item => item.trim()); // 去掉多余空格

            // 提取用户标识（去掉 @ 和括号内的内容）
            const userAliasOnly = user_name.replace(/^@/, '').replace(/$.*$/, '').trim();

            // 检查一次性白名单中是否包含用户
            const index = disposableWhitelistArray.indexOf(userAliasOnly);
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

      if (body.from && body.webhook_url) {
          let textContent = body.text?.content || '';
          textContent = textContent.replace(/^@svn机器人\s*/, '').trim();

          const userAlias = body.from.alias;

          const disposableWhitelistPattern = /^unlock\s+(\S+)(?:\s+(@\S+(?:$[^)]+$)?))+/;
          const disposableWhitelistMatch = textContent.match(disposableWhitelistPattern);

          if (!disposableWhitelistMatch) {
              return res.status(200).json({
                  msgtype: 'text',
                  text: { content: `未识别的指令，请重新输入。` }
              });
          }

          const branchIdentifier = disposableWhitelistMatch[1].trim();
          const targetUsers = textContent.match(/@\S+(?:$[^)]+$)?/g) || [];

          const checkPermissionQuery = `
              SELECT svn_lock_whitelist 
              FROM tb_branch_info 
              WHERE alias = ?
              LIMIT 1
          `;
          const [permissionResults] = await pool.execute(checkPermissionQuery, [branchIdentifier]);

          if (permissionResults.length === 0) {
              return res.status(200).json({
                  msgtype: 'text',
                  text: { content: `分支 ${branchIdentifier} 不存在，请检查分支名称是否正确。` }
              });
          }

          const whitelist = permissionResults[0].svn_lock_whitelist;
          const whitelistArray = whitelist.split(',').map(item => item.trim());

          if (!whitelistArray.includes(userAlias)) {
              return res.status(200).json({
                  msgtype: 'text',
                  text: { content: `${userAlias} 不在分支 ${branchIdentifier} 的永久白名单内，无权执行此操作。` }
              });
          }

          const results = [];
          for (const user of targetUsers) {
              const userAliasOnly = user.replace(/^@/, '').replace(/$.*$/, '').trim();
              const success = await addDisposableWhitelist(branchIdentifier, userAliasOnly);
              results.push({ user, success });
          }

          const successUsers = results.filter(result => result.success).map(result => result.user);
          const failedUsers = results.filter(result => !result.success).map(result => result.user);

          let replyMessage = '';
          if (successUsers.length > 0) {
              replyMessage += `已成功为分支 ${branchIdentifier} 增加一次性白名单用户：${successUsers.join('、')}。\n`;
          }
          if (failedUsers.length > 0) {
              replyMessage += `为分支 ${branchIdentifier} 增加一次性白名单用户失败：${failedUsers.join('、')}，请检查分支或用户信息。`;
          }

          return res.status(200).json({ msgtype: 'text', text: { content: replyMessage } });
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