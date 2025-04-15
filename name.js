const logger = require('./logger'); 
const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise'); // 使用 promise 版本

const app = express();
const PORT = process.argv[2] || 8080;


// 创建数据库连接池配置 - 使用 promise 版本
const pool = mysql.createPool({
  host: '9.134.107.151',
  user: 'root',
  password: 'xuMwn*6829pBfx', // 注意：不要在生产环境中硬编码密码
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

    if (!whitelistArray.includes(whitelistUser)) {
      whitelistArray.push(whitelistUser);
    }

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

// 增加永久白名单的函数
async function addPermanentWhitelist(branchIdentifier, whitelistUser) {
  const checkQuery = 'SELECT svn_lock_whitelist FROM tb_branch_info WHERE svn_branch_name = ? OR alias = ?';
  try {
    const [checkResults] = await pool.execute(checkQuery, [branchIdentifier, branchIdentifier]);
    if (checkResults.length === 0) {
      logger.info(`分支 ${branchIdentifier} 不存在，无法增加永久白名单`);
      return false;
    }

    let currentWhitelist = checkResults[0].svn_lock_whitelist || '';
    const whitelistArray = currentWhitelist.split(',').filter(Boolean);

    if (!whitelistArray.includes(whitelistUser)) {
      whitelistArray.push(whitelistUser);
    }

    const updatedWhitelist = whitelistArray.join(',');
    const updateQuery = 'UPDATE tb_branch_info SET svn_lock_whitelist = ? WHERE svn_branch_name = ? OR alias = ?';
    const [updateResults] = await pool.execute(updateQuery, [updatedWhitelist, branchIdentifier, branchIdentifier]);

    if (updateResults.affectedRows > 0) {
      logger.info(`成功为分支 ${branchIdentifier} 增加永久白名单用户 ${whitelistUser}`);
      return true;
    } else {
      logger.info(`未能为分支 ${branchIdentifier} 增加永久白名单用户 ${whitelistUser}`);
      return false;
    }
  } catch (error) {
    logger.error(`增加永久白名单失败：${error.message}`);
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
        svn_lock_disposable_whitelist,
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

app.post('/', async (req, res) => {
    try {
      const body = req.body;
      logger.info(`Received Request Body: ${JSON.stringify(body)}`);
  
      // 判断是机器人请求还是 Web 钩子请求
      if (body.from && body.webhook_url) {
        // 处理机器人请求
        const textContent = body.text?.content || '';
  
        // 匹配“锁库 分支名”或“开闸 分支名”
        const lockUnlockPattern = /(锁库|开闸)\s+(\S+)/i; // 支持大小写不敏感
        const lockUnlockMatch = textContent.match(lockUnlockPattern);
        logger.info(`解析机器人指令：${lockUnlockMatch ? '匹配成功' : '匹配失败'}`);
  
        if (lockUnlockMatch) {
          logger.info(`匹配到分支操作指令：动作=${lockUnlockMatch[1]}, 分支标识=${lockUnlockMatch[2]}`);
  
          const action = lockUnlockMatch[1]; // "锁库" 或 "开闸"
          const branchIdentifier = lockUnlockMatch[2].trim(); // 分支名称或别名
  
          // 根据动作设置锁定状态
          const svn_lock_status = action === '锁库' ? 1 : 0;
  
          // 调用分支锁定/解锁逻辑，支持通过分支名称或别名操作
          const success = await updateBranchLockStatus(branchIdentifier, svn_lock_status);
  
          // 构造回复消息
          let replyMessage = '';
          if (success) {
            replyMessage = `已成功${svn_lock_status === 1 ? '锁定' : '解锁'}分支 ${branchIdentifier}`;
          } else {
            replyMessage = `${svn_lock_status === 1 ? '锁定' : '解锁'}分支 ${branchIdentifier} 失败，请检查分支是否存在`;
          }
  
          return res.status(200).json({ msgtype: 'text', text: { content: replyMessage } });
        } else {
          logger.info('未匹配到分支操作指令');
          return res.status(200).json({ msgtype: 'text', text: { content: '未识别的指令，请重新输入。' } });
        }
      } else if (body.user_name && body.paths) {
        // 处理 Web 钩子请求
        const result = await handleWebhookRequest(body);
        return res.status(result.status).json(result);
      } else {
        // 未知请求类型
        return res.status(400).json({ status: 400, message: "Unknown request type." });
      }
    } catch (error) {
      logger.error(`处理请求时发生错误：${error.message}`);
      return res.status(500).json({ status: 500, message: error.message });
    }
  });

// 启动服务器
app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
});