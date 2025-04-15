// logger.js
const logLevels = {
    info: 'INFO',
    warn: 'WARN',
    error: 'ERROR'
};

const logger = {
    info: (message) => console.log(`[${logLevels.info}] ${message}`),
    warn: (message) => console.warn(`[${logLevels.warn}] ${message}`),
    error: (message) => console.error(`[${logLevels.error}] ${message}`)
};

module.exports = logger;