// 创建日志工具
const logger = {
    info: (msg) => console.log(`INFO: ${msg}`),
    error: (msg) => console.error(`ERROR: ${msg}`),
  };

  module.exports = logger; // 导出 logger 对象