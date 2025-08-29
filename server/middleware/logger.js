// middleware/logger.js
const useragent = require("useragent");
const winston = require("winston");
const path = require("path");

// ✅ Create logger with file + console output
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(__dirname, "../logs/app.log"),
      maxsize: 5 * 1024 * 1024, // 5 MB rotation
      maxFiles: 5,              // keep last 5 files
    }),
  ],
});

function requestLogger(req, res, next) {
  const agent = useragent.parse(req.headers["user-agent"]);
  const logMessage = `
📥 Request: ${req.method} ${req.originalUrl}
➡️ Device: ${agent.device.toString()}
➡️ OS: ${agent.os.toString()}
➡️ Browser: ${agent.toAgent()}
➡️ Headers: ${JSON.stringify(req.headers)}
➡️ Body: ${JSON.stringify(req.body)}
  `;
  logger.info(logMessage.trim());
  next();
}

function loginLogger(req, res, next) {
  const originalSend = res.send;

  res.send = function (body) {
    if (req.originalUrl.includes("/login")) {
      const agent = useragent.parse(req.headers["user-agent"]);

      let logMessage = `
🔐 Login Attempt:
➡️ Username: ${req.body?.username}
➡️ Device: ${agent.device.toString()}
➡️ OS: ${agent.os.toString()}
➡️ Browser: ${agent.toAgent()}
➡️ Status Code: ${res.statusCode}
`;

      try {
        const parsedBody = JSON.parse(body);
        if (res.statusCode >= 400) {
          logMessage += `❌ Login Failed: ${parsedBody.message || body}`;
        } else {
          logMessage += "✅ Login Success";
        }
      } catch (err) {
        logMessage += `⚠️ Could not parse login response: ${body}`;
      }

      logger.info(logMessage.trim());
    }

    return originalSend.apply(this, arguments);
  };

  next();
}

module.exports = { requestLogger, loginLogger, logger };
