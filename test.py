# -- coding: utf-8 --
"""
路由定义
"""
import json
import logging as logger
from os import getenv
from typing import Optional

import requests
from fastapi import BackgroundTasks, FastAPI, Request, status
from fastapi.responses import JSONResponse
import re

# 配置日志
logger.basicConfig(level=logger.INFO)

# 创建 FastAPI 应用
app = FastAPI(title="企微机器人回调示例")

# 模拟数据库更新函数（实际应替换为真实数据库操作）
def update_branch_lock_status(branch_name: str) -> bool:
    """
    更新分支锁定状态
    :param branch_name: 分支名称
    :return: 是否成功更新
    """
    logger.info(f"尝试锁定分支：{branch_name}")
    # 这里可以替换为真实的数据库操作
    # 示例：假设返回 True 表示更新成功
    return True


@app.post("/", summary="企微机器人回调示例（根路径）")
async def root_callback(
    request: Request,
):
    """
    处理企业微信机器人回调（根路径），并直接在群里回复消息
    """
    try:
        # 获取请求体
        body = await request.json()
        logger.info(f"Received Request Body: {json.dumps(body, ensure_ascii=False)}")

        # 解析请求参数
        webhook_url = body.get("webhook_url", "")
        chat_id = body.get("chatid", "")
        text_content = body.get("text", {}).get("content", "")

        # 检查 content 是否包含 "锁<分支名>分支"
        lock_branch_pattern = r"锁(\S+)分支"
        match = re.search(lock_branch_pattern, text_content)
        if match:
            branch_name = match.group(1)  # 提取分支名称

            # 调用分支锁定逻辑
            success = update_branch_lock_status(branch_name)

            # 构造回复消息
            if success:
                reply_message = f"已成功锁定分支 {branch_name}"
            else:
                reply_message = f"锁定分支 {branch_name} 失败，请检查日志"

            # 直接调用企业微信的回复接口
            response_payload = {
                "msgtype": "text",
                "text": {"content": reply_message},
            }
            return JSONResponse(content=response_payload, status_code=status.HTTP_200_OK)

        # 如果没有匹配到分支锁定指令
        return JSONResponse(
            content={
                "msgtype": "text",
                "text": {"content": "未识别的指令"},
            },
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    except Exception as err:
        logger.error(f"处理请求时发生错误：{err}")
        return JSONResponse(
            content={
                "msgtype": "text",
                "text": {"content": f"处理请求时发生错误：{err}"},
            },
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


if __name__ == "__main__":
    import uvicorn

    # 启动服务
    uvicorn.run(app, host="0.0.0.0", port=8080)