const express = require('express');
const mysql = require('mysql2/promise');
const logger = require('./logger'); // 假设有一个日志模块

const app = express();
app.use(express.json());

// 创建数据库连接池
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'password',
    database: 'your_database',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// 更新分支锁定状态
async function updateBranchLockStatus(branchIdentifier, lockStatus) {
    const query = 'UPDATE tb_branch_info SET svn_lock_status = ? WHERE svn_branch_name = ? OR alias = ?';
    try {
        const [results] = await pool.execute(query, [lockStatus, branchIdentifier, branchIdentifier]);
        return results.affectedRows > 0;
    } catch (error) {
        logger.error(`更新分支锁状态失败：${error.message}`);
        throw error;
    }
}

// 添加一次性白名单用户
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

        return updateResults.affectedRows > 0;
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

            // 匹配“unlock alias”或“lock alias”
            const unlockPattern = /unlock\s+(\S+)/;
            const lockPattern = /lock\s+(\S+)/;

            // 匹配“unlock alias @user1 @user2 ...”
            const disposableWhitelistPattern = /unlock\s+(\S+)\s+@(\S+(?:\s+@\S+)*)/;

            const unlockMatch = textContent.match(unlockPattern);
            const lockMatch = textContent.match(lockPattern);
            const disposableWhitelistMatch = textContent.match(disposableWhitelistPattern);

            if (unlockMatch) {
                // 解锁分支逻辑
                const branchIdentifier = unlockMatch[1]; // 分支名称或别名
                const success = await updateBranchLockStatus(branchIdentifier, 0);
                let replyMessage = '';
                if (success) {
                    replyMessage = `已成功解锁分支 ${branchIdentifier}`;
                } else {
                    replyMessage = `解锁分支 ${branchIdentifier} 失败，请检查分支是否存在`;
                }
                return res.status(200).json({ msgtype: 'text', text: { content: replyMessage } });
            } else if (lockMatch) {
                // 锁定分支逻辑
                const branchIdentifier = lockMatch[1]; // 分支名称或别名
                const success = await updateBranchLockStatus(branchIdentifier, 1);
                let replyMessage = '';
                if (success) {
                    replyMessage = `已成功锁定分支 ${branchIdentifier}`;
                } else {
                    replyMessage = `锁定分支 ${branchIdentifier} 失败，请检查分支是否存在`;
                }
                return res.status(200).json({ msgtype: 'text', text: { content: replyMessage } });
            } else if (disposableWhitelistMatch) {
                // 添加一次性白名单逻辑
                const branchIdentifier = disposableWhitelistMatch[1]; // 分支名称或别名
                const whitelistUsers = disposableWhitelistMatch[2].split(/\s+@/); // 获取所有被@的用户名

                // 检查发起请求的人是否在永久白名单中
                const checkQuery = 'SELECT svn_lock_whitelist FROM tb_branch_info WHERE svn_branch_name = ? OR alias = ?';
                const [checkResults] = await pool.execute(checkQuery, [branchIdentifier, branchIdentifier]);

                if (checkResults.length === 0) {
                    logger.info(`分支 ${branchIdentifier} 不存在，无法增加一次性白名单`);
                    return res.status(200).json({ msgtype: 'text', text: { content: `分支 ${branchIdentifier} 不存在，无法增加一次性白名单` } });
                }

                const currentWhitelist = checkResults[0].svn_lock_whitelist || '';
                const whitelistArray = currentWhitelist.split(',').filter(Boolean);

                if (!whitelistArray.includes(body.user_name)) {
                    return res.status(200).json({ msgtype: 'text', text: { content: '您不在永久白名单里' } });
                }

                for (const whitelistUser of whitelistUsers) {
                    const success = await addDisposableWhitelist(branchIdentifier, whitelistUser.trim());
                    if (!success) {
                        return res.status(200).json({ msgtype: 'text', text: { content: `为分支 ${branchIdentifier} 增加一次性白名单用户 ${whitelistUser} 失败，请检查分支或用户信息` } });
                    }
                }
                return res.status(200).json({ msgtype: 'text', text: { content: `已成功为分支 ${branchIdentifier} 增加一次性白名单用户${whitelistUsers.join('、')}` } });
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

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT}`);
});