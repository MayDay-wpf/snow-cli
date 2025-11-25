import {logger} from '../utils/core/logger.js';

// Test the logger
logger.info('Logger service initialized successfully');
logger.error('Test error message', {errorCode: 500});
logger.warn('Test warning message');
logger.debug('Debug information', {timestamp: Date.now()});

console.log('Logger test completed. Check ./snow/log directory for log files.');