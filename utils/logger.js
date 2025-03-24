const winston = require('winston');
require('winston-daily-rotate-file');

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Daily rotate file transport for production
const fileRotateTransport = new winston.transports.DailyRotateFile({
  filename: 'logs/sukoon-saarthi-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d'
});

// Create the logger instance
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: logFormat,
  defaultMeta: { service: 'sukoon-saarthi-api' },
  transports: [
    // Write logs to rotating files in production
    ...(process.env.NODE_ENV === 'production' 
      ? [fileRotateTransport] 
      : [new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        })
      ])
  ]
});

module.exports = logger;