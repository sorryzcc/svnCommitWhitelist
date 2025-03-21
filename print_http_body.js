const express = require('express');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.argv[2] || 3000;

// 使用body-parser中间件来解析application/json类型的数据
app.use(bodyParser.json());

// POST 路由处理函数
app.post('/', (req, res) => {
    try {
        const request_data = req.body;
        console.log(`Received Request Body: ${JSON.stringify(request_data)}`);

        // 验证必填字段
        const required_fields = ['revision', 'user_id'];
        const missing = required_fields.filter(field => !(field in request_data));
        if (missing.length > 0) {
            throw new Error(`Missing required fields: ${missing.join(', ')}`);
        }

        // 业务逻辑处理
        const user_name = request_data.user_name || 'unknown user';
        const response_message = `Processed commit by ${user_name}`;
        const response = {
            status: 200,
            message: response_message
        };

        console.log(`Sent Response: ${JSON.stringify(response)}`);
        res.status(200).json(response);
    } catch (error) {
        console.error(error.message);
        res.status(400).json({status: 400, message: error.message});
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
process.on('SIGINT', () => {
    console.log("Shutting down server...");
    process.exit();
});